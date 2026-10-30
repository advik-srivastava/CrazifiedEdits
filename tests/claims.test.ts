import assert from "node:assert/strict";
import test from "node:test";
import { sniffImage, validateClaim } from "../lib/claims";
import { buildLedger, weekStatus } from "../lib/billing";
import { adminLedgerReel } from "../lib/public-ledger";
import type { PublicClaim, Reel } from "../lib/models";

const NOW = new Date("2026-10-31T06:00:00Z"); // 31 Oct 2026, 11:30 IST (week 26 Oct – 1 Nov)
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
const good = { week_ending: "2026-11-01", amount: "6000", paid_on: "2026-10-31", method: "UPI", reference: " 4123 5678 ", note: "Week 44" };

test("a valid report is cleaned up", () => {
  assert.deepEqual(validateClaim(form(good), NOW), { week_ending: "2026-11-01", amount: 6000, paid_on: "2026-10-31", method: "UPI", reference: "4123 5678", note: "Week 44" });
  assert.equal(validateClaim(form({ ...good, amount: "₹6,000.50" }), NOW).amount, 6000.5, "₹ and commas are accepted");
  assert.equal(validateClaim(form({ ...good, reference: "", note: "", method: "" }), NOW).reference, null);
});
test("reports are rejected for bad weeks, amounts, dates or methods", () => {
  const bad = (patch: Record<string, string>, msg: RegExp) => assert.throws(() => validateClaim(form({ ...good, ...patch }), NOW), msg);
  bad({ week_ending: "2026-10-31" }, /billing week/);                 // a Saturday, not a week ending
  bad({ week_ending: "2026-11-08" }, /hasn't started/);               // next week
  bad({ week_ending: "2031-01-12" }, /outside 2026/);
  bad({ amount: "0" }, /amount/); bad({ amount: "-5" }, /amount/); bad({ amount: "abc" }, /amount/); bad({ amount: "10.555" }, /two decimal/);
  bad({ paid_on: "2026-11-05" }, /future/); bad({ paid_on: "2026-02-30" }, /date you paid/);
  bad({ method: "Crypto" }, /how you paid/);
});
test("screenshots are identified by content, not by name", () => {
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(sniffImage(new TextEncoder().encode("%PDF-1.7")), null);
  assert.equal(sniffImage(new Uint8Array()), null);
});
test("a reported payment shows on its week but never changes the balance until confirmed", () => {
  const reel: Reel = { id: "r", drive_item_id: null, drive_id: null, source: "manual", title: "R", drive_web_url: null, client_url: null, duration_seconds: 40, status: "delivered", delivery_date: "2026-10-28", notes: null, first_seen_at: "2026-10-28T00:00:00Z", last_seen_at: null, updated_at: "2026-10-28T00:00:00Z" };
  const claims: PublicClaim[] = [
    { key: "k1", week_ending: "2026-11-01", amount: 600, paid_on: "2026-10-31", status: "pending" },
    { key: "k2", week_ending: "2026-11-01", amount: 300, paid_on: "2026-10-30", status: "rejected" },
    { key: "k3", week_ending: "2026-11-01", amount: 999, paid_on: "2026-10-30", status: "confirmed" }
  ];
  const w = buildLedger([adminLedgerReel(reel)], [], "2026-10-31", claims).find(x => x.ending === "2026-11-01")!;
  assert.equal(w.received, 0); assert.equal(w.due, 600); assert.equal(weekStatus(w), "unpaid");
  assert.deepEqual(w.reported.map(c => c.status), ["pending", "rejected"], "confirmed reports appear as real payments instead");
  assert.doesNotMatch(JSON.stringify(w.reported), /reference|note|screenshot|submitter|\bid\b/);
});
