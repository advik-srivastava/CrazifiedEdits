import assert from "node:assert/strict";
import test from "node:test";
import { driveDuration, isVideo, normalizeTitle, planSync, possibleDuplicates, type DriveItem, type ExistingRow } from "../lib/sync-plan";
import { adminEmails, isAdminEmail } from "../lib/admin-emails";

const NOW = "2026-10-31T06:00:00.000Z";
const item = (p: Partial<DriveItem> = {}): DriveItem => ({ id: "fileA123456789012345", name: "Reel 01.mp4", mimeType: "video/mp4", webViewLink: "https://drive.google.com/file/d/fileA/view", createdTime: "2026-10-31T04:00:00Z", modifiedTime: "2026-10-31T04:00:00Z", videoMediaMetadata: { durationMillis: "45200" }, ...p });
const row = (p: Partial<ExistingRow> = {}): ExistingRow => ({ drive_item_id: "fileA123456789012345", status: "discovered", duration_seconds: 46, drive_modified_at: "2026-10-31T04:00:00Z", revision_count: 0, ...p });

test("new Drive files are inserted as pending review, with upload time and duration", () => {
  const { inserts, metadata, patches } = planSync([item()], new Map(), NOW);
  assert.equal(inserts.length, 1); assert.equal(metadata.length, 0); assert.equal(patches.length, 0);
  assert.equal(inserts[0].status, "discovered");
  assert.equal(inserts[0].duration_seconds, 46, "45.2 s rounds up");
  assert.equal(inserts[0].drive_created_at, "2026-10-31T04:00:00Z");
  assert.equal(inserts[0].mime_type, "video/mp4");
});
test("duplicate listings of the same Drive file ID create one record", () => {
  const { inserts } = planSync([item(), item({ name: "Reel 01 (renamed).mp4" }), item()], new Map(), NOW);
  assert.equal(inserts.length, 1);
});
test("re-syncing an existing file never inserts again and never touches billing fields", () => {
  const { inserts, metadata } = planSync([item({ name: "Renamed reel.mp4" })], new Map([["fileA123456789012345", row({ status: "delivered" })]]), NOW);
  assert.equal(inserts.length, 0);
  assert.equal(metadata.length, 1);
  assert.equal(metadata[0].title, "Renamed reel.mp4", "rename updates the title of the same record");
  for (const key of ["status", "delivery_date", "notes", "client_url", "confirmed_rate_inr", "duration_seconds"]) assert.ok(!(key in metadata[0]), `${key} not overwritten`);
  assert.equal(metadata[0].drive_missing_at, null, "a file seen again is no longer flagged missing");
});
test("duration fills in later if Drive hadn't processed it yet", () => {
  const { patches } = planSync([item()], new Map([["fileA123456789012345", row({ status: "delivered", duration_seconds: null })]]), NOW);
  assert.deepEqual(patches, [{ drive_item_id: "fileA123456789012345", patch: { duration_seconds: 46 } }]);
});
test("duration refreshes while pending review but is locked after delivery", () => {
  const replaced = item({ videoMediaMetadata: { durationMillis: "75000" } });
  const pending = planSync([replaced], new Map([["fileA123456789012345", row({ status: "discovered", duration_seconds: 46 })]]), NOW);
  assert.equal(pending.patches[0]?.patch.duration_seconds, 75);
  const delivered = planSync([replaced], new Map([["fileA123456789012345", row({ status: "delivered", duration_seconds: 46 })]]), NOW);
  assert.equal(delivered.patches.length, 0, "a delivered bill can't change because the file was replaced");
});
test("a newer modifiedTime counts as a revision", () => {
  const { patches } = planSync([item({ modifiedTime: "2026-11-02T10:00:00Z" })], new Map([["fileA123456789012345", row({ status: "delivered", revision_count: 1 })]]), NOW);
  assert.deepEqual(patches[0].patch, { revision_count: 2 });
});
test("video detection and duration parsing", () => {
  assert.ok(isVideo({ mimeType: "video/quicktime", name: "a" }));
  assert.ok(isVideo({ mimeType: "application/octet-stream", name: "clip.MOV" }));
  assert.ok(!isVideo({ mimeType: "image/png", name: "thumb.png" }));
  assert.equal(driveDuration(item({ videoMediaMetadata: undefined })), null);
  assert.equal(driveDuration(item({ videoMediaMetadata: { durationMillis: "60000" } })), 60);
  assert.equal(driveDuration(item({ videoMediaMetadata: { durationMillis: "60001" } })), 61);
});
test("unsafe or missing view links fall back to a Drive URL built from the file ID", () => {
  const { inserts } = planSync([item({ webViewLink: "https://evil.example/phish" })], new Map(), NOW);
  assert.equal(inserts[0].drive_web_url, "https://drive.google.com/file/d/fileA123456789012345/view");
});
test("re-uploads of an existing reel are flagged before they can be billed twice", () => {
  const reels = [
    { id: "1", title: "Gut Health Morning.mp4", status: "delivered" },
    { id: "2", title: "Copy of Gut Health Morning.mp4", status: "discovered" },
    { id: "3", title: "gut health morning (1).mov", status: "discovered" },
    { id: "4", title: "Totally different", status: "discovered" },
    { id: "5", title: "Old cancelled", status: "cancelled" },
    { id: "6", title: "Old cancelled", status: "discovered" }
  ];
  const d = possibleDuplicates(reels);
  assert.equal(d.get("2")?.id, "1"); assert.equal(d.get("3")?.id, "1");
  assert.ok(!d.has("1"), "the delivered original is not flagged");
  assert.ok(!d.has("4")); assert.ok(!d.has("6"), "cancelled reels don't count as originals");
  assert.equal(normalizeTitle("Reel_01 - Copy.mp4"), "reel 01");
});
test("admin allow-list: one or many emails, case-insensitive, placeholders ignored", () => {
  assert.deepEqual(adminEmails("Advik@Example.com"), ["advik@example.com"]);
  assert.deepEqual(adminEmails("a@x.com, b@y.com"), ["a@x.com", "b@y.com"]);
  assert.deepEqual(adminEmails("your_admin_email@example.com"), []);
  assert.deepEqual(adminEmails(""), []);
  assert.ok(isAdminEmail("A@X.com", "a@x.com,b@y.com"));
  assert.ok(!isAdminEmail("mohit@x.com", "a@x.com"));
  assert.ok(!isAdminEmail(null, "a@x.com"));
  assert.ok(!isAdminEmail("anyone@x.com", ""), "no admin configured means nobody is admin");
});
