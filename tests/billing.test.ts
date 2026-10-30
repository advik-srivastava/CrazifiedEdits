import assert from "node:assert/strict";
import test from "node:test";
import {
  billable, buildLedger, billingCalendar, istDateOf, ledgerTotals, mondayFor, msUntilIndiaMidnight, pricingState, reelFee,
  shiftISODate, sundayFor, todayAndYesterday, todayInIndia, weekStatus, weekYear, RATE_INR, STANDARD_MAX_SECONDS
} from "../lib/billing";
import { adminLedgerReel } from "../lib/public-ledger";
import type { Reel, Payment } from "../lib/models";

const r = (patch: Partial<Reel> = {}): Reel => ({ id: "r1", drive_item_id: null, drive_id: null, source: "manual", title: "Reel", drive_web_url: null, client_url: null, duration_seconds: 60, status: "delivered", delivery_date: "2026-10-30", notes: null, first_seen_at: "2026-10-30T00:00:00Z", last_seen_at: null, updated_at: "2026-10-30T00:00:00Z", ...patch });
const L = (patch: Partial<Reel> = {}) => adminLedgerReel(r(patch));
const pay = (week_ending: string, amount: number, id = `p-${week_ending}-${amount}`): Payment => ({ id, week_ending, amount, paid_on: week_ending, note: null });

test("agreed commercial terms are unchanged", () => {
  assert.equal(RATE_INR, 600);
  assert.equal(STANDARD_MAX_SECONDS, 60);
});
test("Monday through Sunday share the same week ending", () => {
  assert.equal(sundayFor("2026-10-26"), "2026-11-01");
  assert.equal(sundayFor("2026-10-30"), "2026-11-01");
  assert.equal(sundayFor("2026-11-01"), "2026-11-01");
  assert.equal(sundayFor("2026-11-02"), "2026-11-08");
  assert.equal(mondayFor("2026-11-01"), "2026-10-26");
});
test("₹600 pricing rule with 60-second boundary", () => {
  assert.equal(reelFee(r({ duration_seconds: 1 })), 600);
  assert.equal(reelFee(r({ duration_seconds: 59 })), 600);
  assert.equal(reelFee(r({ duration_seconds: 60 })), 600, "exactly 60 s is billable");
  assert.equal(reelFee(r({ duration_seconds: 61 })), 0, "61 s needs pricing review");
  assert.equal(pricingState(r({ duration_seconds: 61 })), "review");
  assert.equal(pricingState(r({ duration_seconds: null })), "review", "unknown duration needs review");
  assert.equal(reelFee(r({ duration_seconds: null })), 0);
  assert.equal(reelFee(r({ duration_seconds: 0 })), 0);
});
test("only delivered/approved/revision reels with a delivery date are billed", () => {
  assert.equal(reelFee(r({ status: "discovered" })), 0, "new upload pending review is never billed");
  assert.equal(pricingState(r({ status: "discovered" })), "not_billable");
  assert.equal(reelFee(r({ status: "cancelled" })), 0);
  assert.equal(reelFee(r({ status: "revision" })), 600);
  assert.equal(reelFee(r({ status: "approved" })), 600);
  assert.equal(reelFee(r({ delivery_date: null })), 0);
  assert.equal(billable(r()), true);
});
test("longer reels bill only at an explicitly confirmed price", () => {
  assert.equal(reelFee(r({ duration_seconds: 95, confirmed_rate_inr: 1000 })), 1000);
  assert.equal(pricingState(r({ duration_seconds: 95, confirmed_rate_inr: "1000.00" })), "confirmed", "Supabase numeric strings are accepted");
  assert.equal(reelFee(r({ duration_seconds: null, confirmed_rate_inr: 750 })), 750);
  assert.equal(reelFee(r({ duration_seconds: 95, confirmed_rate_inr: 0 })), 0, "zero is not a confirmed price");
  assert.equal(reelFee(r({ duration_seconds: 45, confirmed_rate_inr: 5000 })), 600, "standard reels always bill ₹600");
  assert.equal(reelFee(r({ status: "discovered", duration_seconds: 95, confirmed_rate_inr: 1000 })), 0);
});
test("weekly billed, partial payments and balance due", () => {
  const reels = [L(), L({ id: "r2", delivery_date: "2026-11-01" }), L({ id: "r3", delivery_date: "2026-11-02" })];
  const weeks = buildLedger(reels, [pay("2026-11-01", 500)], "2026-10-30");
  const first = weeks.find(w => w.ending === "2026-11-01")!;
  assert.equal(first.count, 2); assert.equal(first.billed, 1200); assert.equal(first.received, 500); assert.equal(first.due, 700);
  assert.equal(weekStatus(first), "partial");
  assert.equal(weeks.find(w => w.ending === "2026-11-08")?.billed, 600);
});
test("brief example: 25 reels, ₹9,000 received → ₹6,000 outstanding", () => {
  const reels = Array.from({ length: 25 }, (_, i) => L({ id: `r${i}`, delivery_date: shiftISODate("2026-10-26", i % 7), duration_seconds: 30 + i }));
  const week = buildLedger(reels, [pay("2026-11-01", 4000, "a"), pay("2026-11-01", 5000, "b")], "2026-10-30").find(w => w.ending === "2026-11-01")!;
  assert.equal(week.count, 25); assert.equal(week.billed, 15000); assert.equal(week.received, 9000); assert.equal(week.due, 6000);
  assert.equal(weekStatus(week), "partial");
});
test("week payment status: no charges, unpaid, partial, paid, overpaid", () => {
  assert.equal(weekStatus({ billed: 0, received: 0 }), "no_charges");
  assert.equal(weekStatus({ billed: 1200, received: 0 }), "unpaid");
  assert.equal(weekStatus({ billed: 1200, received: 600 }), "partial");
  assert.equal(weekStatus({ billed: 1200, received: 1200 }), "paid");
  assert.equal(weekStatus({ billed: 1200, received: 1500 }), "paid");
  const w = buildLedger([L()], [pay("2026-11-01", 1000)], "2026-10-30").find(x => x.ending === "2026-11-01")!;
  assert.equal(w.due, -400, "overpayment shows as a negative balance (credit)");
});
test("payments are allocated only to their own week", () => {
  const weeks = buildLedger([L({ delivery_date: "2026-10-26" }), L({ id: "b", delivery_date: "2026-11-03" })], [pay("2026-11-08", 600)], "2026-10-30");
  assert.equal(weeks.find(w => w.ending === "2026-11-01")!.due, 600);
  assert.equal(weeks.find(w => w.ending === "2026-11-08")!.due, 0);
});
test("decimal payments do not drift", () => {
  const w = buildLedger([L()], [pay("2026-11-01", 100.1, "a"), pay("2026-11-01", 200.2, "b")], "2026-10-30").find(x => x.ending === "2026-11-01")!;
  assert.equal(w.received, 300.3); assert.equal(w.due, 299.7);
});
test("all-time totals sum every week once", () => {
  const weeks = buildLedger([L(), L({ id: "b", delivery_date: "2027-03-03" }), L({ id: "c", duration_seconds: 120 })], [pay("2026-11-01", 600)], "2026-10-30");
  const t = ledgerTotals(weeks);
  assert.deepEqual(t, { delivered: 3, billedReels: 2, billed: 1200, received: 600, outstanding: 600, reviewCount: 1 });
});
test("date rollovers are UTC-safe", () => {
  assert.equal(shiftISODate("2026-12-31", 1), "2027-01-01"); assert.equal(shiftISODate("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftISODate("2028-02-28", 1), "2028-02-29", "2028 leap day");
  assert.throws(() => shiftISODate("2026-02-30", 1));
});
test("the weekly log includes delivered reels awaiting pricing review", () => {
  const w = buildLedger([L({ id: "long", duration_seconds: 90 })], [], "2026-10-30").find(x => x.ending === "2026-11-01")!;
  assert.equal(w.reels.length, 1); assert.equal(w.delivered, 1); assert.equal(w.reviewCount, 1);
  assert.equal(w.billed, 0); assert.equal(w.count, 0);
});
test("billing calendar: uninterrupted Monday–Sunday weeks through December 2030", () => {
  const weeks = billingCalendar();
  assert.equal(weeks[0].starting, "2025-12-29");
  assert.equal(weeks[0].ending, "2026-01-04");
  assert.equal(weeks.at(-1)?.starting, "2030-12-30");
  assert.equal(weeks.at(-1)?.ending, "2031-01-05");
  assert.equal(weeks.length, 262);
  for (let i = 0; i < weeks.length; i++) {
    assert.equal(new Date(`${weeks[i].starting}T12:00:00Z`).getUTCDay(), 1, `${weeks[i].starting} is a Monday`);
    assert.equal(new Date(`${weeks[i].ending}T12:00:00Z`).getUTCDay(), 0, `${weeks[i].ending} is a Sunday`);
    assert.equal(shiftISODate(weeks[i].starting, 6), weeks[i].ending);
    if (i) assert.equal(weeks[i].starting, shiftISODate(weeks[i - 1].starting, 7));
  }
});
test("every day from 2026 to 2030 maps into exactly one calendar week", () => {
  const endings = new Set(billingCalendar().map(w => w.ending));
  for (let d = "2026-01-01"; d <= "2030-12-31"; d = shiftISODate(d, 1)) {
    const s = sundayFor(d);
    assert.ok(endings.has(s), `${d} → ${s}`);
    assert.ok(mondayFor(d) <= d && d <= s);
  }
});
test("each year 2026–2030 has selectable weeks; year-boundary weeks are filed once", () => {
  const byYear = new Map<string, number>();
  for (const w of billingCalendar()) byYear.set(weekYear(w), (byYear.get(weekYear(w)) || 0) + 1);
  assert.deepEqual([...byYear.keys()], ["2026", "2027", "2028", "2029", "2030"]);
  for (const n of byYear.values()) assert.ok(n === 52 || n === 53);
  assert.equal(weekYear({ starting: "2025-12-29", ending: "2026-01-04" }), "2026");
  assert.equal(weekYear({ starting: "2026-12-28", ending: "2027-01-03" }), "2026");
  assert.equal(weekYear({ starting: "2030-12-30", ending: "2031-01-05" }), "2030");
  const yearEdge = buildLedger([L({ delivery_date: "2027-01-02" })], [], "2026-10-30").find(w => w.ending === "2027-01-03")!;
  assert.equal(yearEdge.starting, "2026-12-28"); assert.equal(yearEdge.billed, 600);
});
test("pre-created empty weeks can be selected and carry no charges", () => {
  const all = buildLedger([], [], "2026-10-30");
  assert.equal(all.length, 262);
  const future = all.find(w => w.ending === "2029-11-04")!;
  assert.equal(future.billed, 0); assert.equal(future.received, 0); assert.equal(future.reels.length, 0);
  assert.equal(weekStatus(future), "no_charges");
});
test("India date: midnight IST is 18:30 UTC", () => {
  assert.equal(todayInIndia(new Date("2026-10-30T18:29:59Z")), "2026-10-30");
  assert.equal(todayInIndia(new Date("2026-10-30T18:30:00Z")), "2026-10-31");
  assert.equal(todayInIndia(new Date("2026-12-31T18:30:00Z")), "2027-01-01");
  assert.equal(istDateOf("2026-10-30T20:00:00Z"), "2026-10-31");
  assert.equal(istDateOf(null), null);
  assert.equal(istDateOf("garbage"), null);
});
test("milliseconds until the next India midnight", () => {
  assert.equal(msUntilIndiaMidnight(new Date("2026-10-30T18:29:00Z")), 60_000);
  assert.equal(msUntilIndiaMidnight(new Date("2026-10-30T18:30:00Z")), 86_400_000);
  assert.equal(msUntilIndiaMidnight(new Date("2026-10-30T12:30:00Z")), 6 * 3_600_000);
});
test("Today/Yesterday: upload date and delivery date are counted separately, across midnight IST", () => {
  const reels = [
    // Uploaded yesterday evening IST (still pending), uploaded just after midnight IST today.
    r({ id: "a", source: "google_drive", status: "discovered", delivery_date: null, drive_created_at: "2026-10-30T18:29:00Z", duration_seconds: 40 }),
    r({ id: "b", source: "google_drive", status: "discovered", delivery_date: null, drive_created_at: "2026-10-30T18:31:00Z", duration_seconds: 40 }),
    // Uploaded yesterday, delivered today.
    r({ id: "c", source: "google_drive", status: "delivered", delivery_date: "2026-10-31", drive_created_at: "2026-10-30T10:00:00Z", duration_seconds: 50 }),
    // Delivered today but over 60 s: delivered count yes, billed amount no.
    r({ id: "d", status: "delivered", delivery_date: "2026-10-31", first_seen_at: "2026-10-31T03:00:00Z", duration_seconds: 75 }),
    // Cancelled upload is not counted.
    r({ id: "e", source: "google_drive", status: "cancelled", delivery_date: null, drive_created_at: "2026-10-31T04:00:00Z" })
  ];
  const now = new Date("2026-10-31T06:00:00Z"); // 11:30 IST on 31 Oct
  const { today, yesterday } = todayAndYesterday(reels, adminLedgerReel, now);
  assert.equal(today.date, "2026-10-31"); assert.equal(yesterday.date, "2026-10-30");
  assert.deepEqual([today.uploaded, today.delivered, today.billed, today.pendingReview], [2, 2, 600, 1]);
  assert.deepEqual([yesterday.uploaded, yesterday.delivered, yesterday.billed, yesterday.pendingReview], [2, 0, 0, 1]);
  // Ten minutes before midnight IST the same data is "today = 30 Oct".
  const before = todayAndYesterday(reels, adminLedgerReel, new Date("2026-10-30T18:20:00Z"));
  assert.equal(before.today.date, "2026-10-30"); assert.equal(before.today.uploaded, 2);
});
