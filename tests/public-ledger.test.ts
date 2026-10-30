import assert from "node:assert/strict";
import test from "node:test";
import { publicReels, publicPayments, publicLedgerReel, opaqueKey } from "../lib/public-ledger";
import { todayAndYesterday } from "../lib/billing";
import type { Payment, Reel } from "../lib/models";

const base: Reel = {
  id: "5d1c8a52-7e0b-4c49-9a5e-2f0b8b1f0a11", drive_item_id: "private-drive-id", drive_id: "internal-drive",
  source: "google_drive", title: "Mohit Reel #01", drive_web_url: "https://drive.google.com/file/d/private-drive-id/view",
  client_url: null, duration_seconds: 46, status: "delivered",
  delivery_date: "2026-10-30", notes: "Private note: do not reveal", first_seen_at: "2026-10-29T00:00:00Z",
  last_seen_at: null, updated_at: "2026-10-30T00:00:00Z", mime_type: "video/mp4", revision_count: 2,
  drive_created_at: "2026-10-29T00:00:00Z", drive_modified_at: "2026-10-30T00:00:00Z", drive_missing_at: null
};
const FORBIDDEN = /5d1c8a52|internal-drive|Private note|first_seen_at|updated_at|drive_item_id|revision_count|mime_type|drive_modified|notes/;

test("public ledger shows delivered reels but not pending uploads or cancellations", () => {
  const result = publicReels([base, { ...base, id: "unapproved", status: "discovered", delivery_date: null }, { ...base, id: "cancelled", status: "cancelled" }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Mohit Reel #01");
});
test("public reels never serialize notes, database IDs or internal Drive metadata", () => {
  const [item] = publicReels([base]);
  assert.doesNotMatch(JSON.stringify(item), FORBIDDEN);
  assert.equal(item.key, opaqueKey(base.id));
  assert.notEqual(item.key, base.id);
  assert.equal(item.drive_web_url, base.drive_web_url, "the Drive view link is shared with the client");
});
test("a client-specific link replaces the raw Drive link", () => {
  const item = publicLedgerReel({ ...base, client_url: "https://drive.google.com/file/d/shared/view" });
  assert.equal(item.client_url, "https://drive.google.com/file/d/shared/view");
  assert.equal(item.drive_web_url, null);
});
test("public payments expose amount and dates only: no reference, method or ID", () => {
  const payments: Payment[] = [{ id: "9a8b7c6d-0000-4000-8000-000000000001", week_ending: "2026-11-01", amount: 600, paid_on: "2026-11-01", note: "UPI ref 99887766", method: "UPI" }];
  const [p] = publicPayments(payments);
  assert.equal(p.amount, 600);
  assert.equal(p.note, null); assert.equal(p.method, null);
  assert.doesNotMatch(JSON.stringify(p), /99887766|UPI|9a8b7c6d/);
});
test("public Today/Yesterday lists only delivered reels; pending uploads appear as counts only", () => {
  const pending = { ...base, id: "p1", title: "SECRET DRAFT", status: "discovered" as const, delivery_date: null, drive_created_at: "2026-10-31T04:00:00Z" };
  const delivered = { ...base, delivery_date: "2026-10-31" };
  const { today } = todayAndYesterday([pending, delivered], publicLedgerReel, new Date("2026-10-31T06:00:00Z"));
  assert.equal(today.pendingReview, 1);
  assert.equal(today.deliveredReels.length, 1);
  const json = JSON.stringify(today);
  assert.doesNotMatch(json, /SECRET DRAFT/);
  assert.doesNotMatch(json, FORBIDDEN);
});
