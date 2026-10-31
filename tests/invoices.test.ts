import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  DEFAULT_PROFILE, dueDate, formatInvoiceNumber, invoiceItems, invoicePayState, invoicePeriod, invoiceWeekEnding,
  nextInvoiceNumber, normalizeProfile, periodsOverlap
} from "../lib/invoices";
import { renderInvoicePdf } from "../lib/invoice-pdf";
import type { Reel } from "../lib/models";

const reel = (p: Partial<Reel> = {}): Reel => ({ id: "r", drive_item_id: null, drive_id: null, source: "manual", title: "Reel", drive_web_url: null, client_url: null, duration_seconds: 45, status: "delivered", delivery_date: "2026-10-28", notes: "private", first_seen_at: "2026-10-28T00:00:00Z", last_seen_at: null, updated_at: "2026-10-28T00:00:00Z", ...p });

test("weekly invoices cover Monday–Sunday; daily invoices cover one day", () => {
  assert.deepEqual(invoicePeriod("weekly", "2026-10-31"), { start: "2026-10-26", end: "2026-11-01" });
  assert.deepEqual(invoicePeriod("weekly", "2026-11-01"), { start: "2026-10-26", end: "2026-11-01" });
  assert.deepEqual(invoicePeriod("weekly", "2026-12-30"), { start: "2026-12-28", end: "2027-01-03" }, "year-crossing week");
  assert.deepEqual(invoicePeriod("daily", "2026-10-31"), { start: "2026-10-31", end: "2026-10-31" });
});
test("invoice lines: only billed reels delivered in the period, ₹600 rule and confirmed prices", () => {
  const reels = [
    reel({ id: "a", title: "B reel", delivery_date: "2026-10-27" }),
    reel({ id: "b", title: "A reel", delivery_date: "2026-10-27", duration_seconds: 60 }),
    reel({ id: "c", delivery_date: "2026-10-29", duration_seconds: 95, confirmed_rate_inr: "900.00" }),
    reel({ id: "d", delivery_date: "2026-10-30", duration_seconds: 95 }),                  // awaiting a price
    reel({ id: "e", delivery_date: "2026-10-30", status: "discovered" }),                  // not delivered
    reel({ id: "f", delivery_date: "2026-10-30", status: "cancelled", deleted_at: "x" }),  // deleted
    reel({ id: "g", delivery_date: "2026-11-02" })                                         // next week
  ];
  const { items, total, awaitingPrice } = invoiceItems(reels, "2026-10-26", "2026-11-01");
  assert.deepEqual(items.map(i => [i.title, i.amount]), [["A reel", 600], ["B reel", 600], ["Reel", 900]]);
  assert.equal(total, 2100); assert.equal(awaitingPrice, 1);
  assert.ok(!JSON.stringify(items).includes("private"), "notes never go on an invoice");
  assert.equal(invoiceItems(reels, "2026-10-27", "2026-10-27").total, 1200, "daily invoice");
  assert.equal(invoiceItems(reels, "2026-11-09", "2026-11-15").items.length, 0);
});
test("invoice numbers: CS-MS-01, CS-MS-02… in one running series", () => {
  assert.equal(formatInvoiceNumber("CS-MS", 1), "CS-MS-01");
  assert.equal(formatInvoiceNumber("CS-MS", 123), "CS-MS-123");
  assert.equal(nextInvoiceNumber([], "CS-MS"), "CS-MS-01");
  assert.equal(nextInvoiceNumber(["CS-MS-01", "CS-MS-09", "CE-2026-0040", "CS-MSX-50"], "CS-MS"), "CS-MS-10", "other series are ignored");
  assert.equal(nextInvoiceNumber(["CS-MS-99"], "CS-MS"), "CS-MS-100");
});
test("invoice prefix: defaults to CS-MS, cleaned to letters/digits/dashes", () => {
  assert.equal(normalizeProfile({}).invoice_prefix, "CS-MS");
  assert.equal(normalizeProfile({ invoice_prefix: " cs-ms " }).invoice_prefix, "CS-MS");
  assert.equal(normalizeProfile({ invoice_prefix: "CS / MS" }).invoice_prefix, "CSMS");
  assert.equal(normalizeProfile({ invoice_prefix: "-" }).invoice_prefix, "CS-MS");
  assert.equal(normalizeProfile({}).client_name, "Mohit Sharma");
});
test("overlap protection: a day inside an invoiced week, and the week containing an invoiced day", () => {
  const week = invoicePeriod("weekly", "2026-10-28");
  assert.ok(periodsOverlap(week, invoicePeriod("daily", "2026-11-01")));
  assert.ok(periodsOverlap(invoicePeriod("daily", "2026-10-26"), week));
  assert.ok(!periodsOverlap(week, invoicePeriod("daily", "2026-11-02")));
  assert.ok(!periodsOverlap(week, invoicePeriod("weekly", "2026-11-02")));
});
test("paid status: unpaid, partial, paid, void", () => {
  assert.equal(invoicePayState(1200, 0), "unpaid");
  assert.equal(invoicePayState(1200, 600), "partial");
  assert.equal(invoicePayState(1200, 1200), "paid");
  assert.equal(invoicePayState(1200, 1199.999), "paid", "rounding");
  assert.equal(invoicePayState(1200, 0, true), "void");
});
test("payments through an invoice count for the invoice's billing week", () => {
  assert.equal(invoiceWeekEnding("2026-11-01"), "2026-11-01");
  assert.equal(invoiceWeekEnding("2026-10-28"), "2026-11-01", "daily invoice on a Wednesday");
  assert.equal(dueDate("2026-11-01", 7), "2026-11-08");
  assert.equal(dueDate("2026-11-01", 0), "2026-11-01");
});
test("invoice details: defaults, trimming, limits, bad values ignored", () => {
  assert.deepEqual(normalizeProfile(null), DEFAULT_PROFILE);
  const p = normalizeProfile({ business_name: "  ", upi_id: " advik@upi ", payment_terms_days: "500", client_address: "x".repeat(400), evil: "<script>" });
  assert.equal(p.business_name, "Crazified Studios"); assert.equal(p.upi_id, "advik@upi");
  assert.equal(p.payment_terms_days, 7); assert.equal(p.client_address.length, 300);
  assert.ok(!("evil" in p));
  assert.equal(normalizeProfile({ payment_terms_days: "14" }).payment_terms_days, 14);
});

const assets = () => {
  const f = (p: string) => new Uint8Array(fs.readFileSync(new URL(`../${p}`, import.meta.url)));
  return { regular: f("assets/fonts/DMSans_400Regular.ttf"), bold: f("assets/fonts/DMSans_700Bold.ttf"), heavy: f("assets/fonts/Manrope_800ExtraBold.ttf"), logo: f("public/images/crazified-logo.png") };
};
const data = (n: number, paid = 0) => ({
  number: "CS-MS-01", kind: "weekly" as const, period_start: "2026-10-26", period_end: "2026-11-01", issue_date: "2026-11-01", due_date: "2026-11-08",
  items: Array.from({ length: n }, (_, i) => ({ title: `Reel ${i + 1} 🔥 with ₹ in the name`, delivered: "2026-10-28", seconds: 45, amount: 600 })),
  total: n * 600, paid, profile: normalizeProfile({ upi_id: "advik@upi" }), notes: null, voided: false
});
test("PDF: valid A4 document, one page for a normal week", async () => {
  const bytes = await renderInvoicePdf(data(8), assets());
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 1 && Math.abs(height - 841.89) < 1);
  assert.equal(doc.getTitle(), "Invoice CS-MS-01");
});
test("PDF: long weeks flow onto extra pages; emoji in titles don't break it", async () => {
  const doc = await PDFDocument.load(await renderInvoicePdf(data(60), assets()));
  assert.ok(doc.getPageCount() >= 3);
});
test("PDF: renders paid and void invoices, and works without a logo", async () => {
  await renderInvoicePdf(data(2, 1200), assets());
  await renderInvoicePdf({ ...data(2), voided: true }, { ...assets(), logo: null });
});

test("a weekly invoice totals exactly what the weekly log bills for that week", async () => {
  const { buildLedger } = await import("../lib/billing");
  const { adminLedgerReel } = await import("../lib/public-ledger");
  const reels = [
    reel({ id: "1", title: "1_Mohit.mp4", delivery_date: "2026-10-30" }),
    ...[2, 3, 4, 5, 6].map(n => reel({ id: String(n), title: `${n}_Mohit.mp4`, delivery_date: "2026-10-31" })),
    reel({ id: "7", delivery_date: "2026-10-31", duration_seconds: 80 }),                         // awaiting price
    reel({ id: "8", delivery_date: "2026-10-31", status: "cancelled", deleted_at: "2026-10-31" }) // deleted
  ];
  const week = buildLedger(reels.filter(r => r.delivery_date).map(adminLedgerReel), [], "2026-10-31").find(w => w.ending === "2026-11-01")!;
  const inv = invoiceItems(reels, "2026-10-26", "2026-11-01");
  assert.equal(inv.items.length, week.count); assert.equal(inv.total, week.billed);
  assert.equal(inv.total, 3600, "all six reels in the week, not just today's five");
  assert.equal(invoiceItems(reels, "2026-10-31", "2026-10-31").total, 3000, "today's invoice: only reels delivered today");
});
