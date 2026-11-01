import assert from "node:assert/strict";
import test from "node:test";
import { allowedWeeks, buildLedger, reelWeek, todayAndYesterday } from "../lib/billing";
import { invoiceItems } from "../lib/invoices";
import { adminLedgerReel, publicLedgerReel } from "../lib/public-ledger";
import { normalizeTitle, possibleDuplicates } from "../lib/sync-plan";
import type { Reel } from "../lib/models";

const reel = (p: Partial<Reel> = {}): Reel => ({ id: "r", drive_item_id: null, drive_id: null, source: "manual", title: "Reel", drive_web_url: null, client_url: null, duration_seconds: 45, status: "delivered", delivery_date: "2026-11-02", notes: null, first_seen_at: "2026-11-02T00:00:00Z", last_seen_at: null, updated_at: "2026-11-02T00:00:00Z", ...p });

test("a reel counts in its delivery week unless moved", () => {
  assert.equal(reelWeek(reel()), "2026-11-08", "Mon 2 Nov → week ending Sun 8 Nov");
  assert.equal(reelWeek(reel({ billing_week_override: "2026-11-01" })), "2026-11-01", "moved to last week");
  assert.equal(reelWeek(reel({ billing_week_override: "2026-11-03" })), "2026-11-08", "an invalid (non-Sunday) override is ignored");
  assert.equal(reelWeek(reel({ delivery_date: null, billing_week_override: "2026-11-01" })), null, "not delivered → no week");
  assert.equal(adminLedgerReel(reel({ billing_week_override: "2026-11-01" })).week_ending, "2026-11-01");
  assert.equal(publicLedgerReel(reel()).week_ending, "2026-11-08");
});
test("a reel can move to its own week or up to 4 weeks earlier", () => {
  assert.deepEqual(allowedWeeks("2026-11-02"), ["2026-11-08", "2026-11-01", "2026-10-25", "2026-10-18", "2026-10-11"]);
  assert.deepEqual(allowedWeeks("2027-01-01", 1), ["2027-01-03", "2026-12-27"], "across New Year");
});
test("changes delivered on Monday, moved to last week: billed in last week, not this week", () => {
  const reels = [
    reel({ id: "a", title: "Sunday reel", delivery_date: "2026-11-01" }),
    reel({ id: "b", title: "Monday changes", delivery_date: "2026-11-02", billing_week_override: "2026-11-01" }),
    reel({ id: "c", title: "Normal Monday reel", delivery_date: "2026-11-02" })
  ];
  const weeks = buildLedger(reels.map(adminLedgerReel), [], "2026-11-02");
  const last = weeks.find(w => w.ending === "2026-11-01")!, now = weeks.find(w => w.ending === "2026-11-08")!;
  assert.equal(last.count, 2); assert.equal(last.billed, 1200);
  assert.equal(now.count, 1); assert.equal(now.billed, 600);
  // Weekly invoices follow the billing week.
  assert.deepEqual(invoiceItems(reels, "2026-10-26", "2026-11-01", "weekly").items.map(i => i.title), ["Sunday reel", "Monday changes"]);
  assert.deepEqual(invoiceItems(reels, "2026-11-02", "2026-11-08", "weekly").items.map(i => i.title), ["Normal Monday reel"]);
  // A daily invoice for Monday excludes the reel counted in last week.
  assert.deepEqual(invoiceItems(reels, "2026-11-02", "2026-11-02", "daily").items.map(i => i.title), ["Normal Monday reel"]);
  // Today/Yesterday still go by the real delivery date.
  const { today } = todayAndYesterday(reels, adminLedgerReel, new Date("2026-11-02T06:00:00Z"));
  assert.equal(today.delivered, 2);
});
test("revised uploads are recognised as re-uploads of the original", () => {
  for (const name of ["5_Mohit_v2.mp4", "5_Mohit final.mp4", "5 Mohit - revised v3.mov", "Copy of 5_Mohit.mp4", "5_Mohit (1).mp4", "5_Mohit changes.mp4"]) {
    assert.equal(normalizeTitle(name), "5 mohit", name);
  }
  assert.equal(normalizeTitle("Final countdown.mp4"), "final countdown", "only trailing markers are removed");
  assert.equal(normalizeTitle("New year reel.mp4"), "new year reel");
  const d = possibleDuplicates([{ id: "1", title: "5_Mohit.mp4", status: "delivered" }, { id: "2", title: "5_Mohit_v2.mp4", status: "discovered" }]);
  assert.equal(d.get("2")?.id, "1");
});
