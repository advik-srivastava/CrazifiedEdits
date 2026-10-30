import assert from "node:assert/strict";
import test from "node:test";
import { canPurge, deletePatch, isDeleted, restorePatch } from "../lib/reel-delete";
import { planSync, type DriveItem, type ExistingRow } from "../lib/sync-plan";
import { buildLedger, todayAndYesterday } from "../lib/billing";
import { adminLedgerReel, publicReels } from "../lib/public-ledger";
import type { Reel } from "../lib/models";

const NOW = "2026-10-31T06:00:00.000Z";
const reel = (p: Partial<Reel> = {}): Reel => ({ id: "11111111-1111-4111-8111-111111111111", drive_item_id: "fileA123456789012345", drive_id: null, source: "google_drive", title: "Reel", drive_web_url: null, client_url: null, duration_seconds: 45, status: "delivered", delivery_date: "2026-10-30", notes: null, first_seen_at: NOW, last_seen_at: NOW, updated_at: NOW, ...p });

test("deleting a delivered reel cancels it, remembers its status and blocks auto-restore", () => {
  const p = deletePatch(reel({ status: "delivered" }), NOW);
  assert.deepEqual(p, { status: "cancelled", deleted_at: NOW, status_before_removal: "delivered", removed_by_sync: false, updated_at: NOW });
});
test("deleting an already-cancelled reel keeps the status it had before", () => {
  assert.equal(deletePatch(reel({ status: "cancelled", status_before_removal: "approved" }), NOW).status_before_removal, "approved");
  assert.equal(deletePatch(reel({ status: "cancelled" }), NOW).status_before_removal, null);
});
test("a deleted reel leaves billing, the client page and Today counts", () => {
  const deleted = { ...reel(), ...deletePatch(reel(), NOW) } as Reel;
  const week = buildLedger([deleted].filter(r => r.delivery_date).map(adminLedgerReel), [], "2026-10-31").find(w => w.ending === "2026-11-01")!;
  assert.equal(week.billed, 0); assert.equal(week.delivered, 0);
  assert.equal(publicReels([deleted]).length, 0);
  const { yesterday } = todayAndYesterday([deleted], adminLedgerReel, new Date(NOW));
  assert.equal(yesterday.delivered, 0);
});
test("restore returns the previous status", () => {
  assert.deepEqual(restorePatch(reel({ status_before_removal: "approved" }), NOW), { status: "approved", deleted_at: null, status_before_removal: null, removed_by_sync: false, updated_at: NOW });
  assert.equal(restorePatch(reel({ status_before_removal: null }), NOW).status, "discovered");
});
test("permanent delete only when nothing can re-import the reel", () => {
  assert.ok(!canPurge(reel({ deleted_at: null, source: "manual" })), "must be deleted first");
  assert.ok(canPurge(reel({ deleted_at: NOW, source: "manual" })));
  assert.ok(!canPurge(reel({ deleted_at: NOW, source: "google_drive", drive_missing_at: null })), "Drive file still exists → next sync would re-add it");
  assert.ok(canPurge(reel({ deleted_at: NOW, source: "google_drive", drive_missing_at: NOW })));
  assert.ok(isDeleted(reel({ deleted_at: NOW }))); assert.ok(!isDeleted(reel()));
});
test("sync: a file you deleted in CrazifiedEdits is not restored or re-imported while it stays in Drive", () => {
  const item: DriveItem = { id: "fileA123456789012345", name: "Reel.mp4", mimeType: "video/mp4", createdTime: NOW, modifiedTime: NOW };
  const existing = new Map<string, ExistingRow>([["fileA123456789012345", { drive_item_id: "fileA123456789012345", status: "cancelled", duration_seconds: 45, drive_modified_at: NOW, revision_count: 0, removed_by_sync: false, status_before_removal: "delivered" }]]);
  const plan = planSync([item], existing, NOW, { autoDeliver: true });
  assert.equal(plan.inserts.length, 0);
  assert.ok(!plan.patches.some(p => p.patch.status), "status unchanged");
});
test("sync: a file deleted from Drive and then restored comes back, undeleted", () => {
  const item: DriveItem = { id: "fileA123456789012345", name: "Reel.mp4", mimeType: "video/mp4", createdTime: NOW, modifiedTime: NOW };
  const existing = new Map<string, ExistingRow>([["fileA123456789012345", { drive_item_id: "fileA123456789012345", status: "cancelled", duration_seconds: 45, drive_modified_at: NOW, revision_count: 0, removed_by_sync: true, status_before_removal: "delivered" }]]);
  const [p] = planSync([item], existing, NOW).patches;
  assert.equal(p.patch.status, "delivered"); assert.equal(p.patch.deleted_at, null); assert.equal(p.patch.removed_by_sync, false);
});
