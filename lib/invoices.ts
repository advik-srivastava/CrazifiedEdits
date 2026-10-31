/**
 * Invoices (no GST). Pure rules shared by the server, the PDF and the tests.
 * An invoice covers either one Monday–Sunday billing week or one day, and lists the reels delivered in
 * that period that are billed (₹600 up to 60 s, or a confirmed price). Its lines are a snapshot taken when
 * it's created. Payments recorded "through" an invoice are ordinary payments for its week, linked to it.
 */
import type { Reel } from "./models";
import { mondayFor, reelFee, pricingState, shiftISODate, sundayFor, BILLED_STATES } from "./billing";

export type InvoiceKind = "weekly" | "daily";
export type InvoiceItem = { title: string; delivered: string; seconds: number | null; amount: number };
export type InvoiceProfile = {
  /** Invoice numbers are PREFIX-01, PREFIX-02… e.g. CS-MS-01 (Crazified Studios → Mohit Sharma). */
  invoice_prefix: string;
  business_name: string;
  owner_name: string;
  email: string;
  phone: string;
  address: string;
  upi_id: string;
  bank_details: string;
  client_name: string;
  client_handle: string;
  client_address: string;
  client_email: string;
  payment_terms_days: number;
  footer_note: string;
};
export const DEFAULT_PROFILE: InvoiceProfile = {
  invoice_prefix: "CS-MS",
  business_name: "Crazified Studios",
  owner_name: "Advik",
  email: "",
  phone: "",
  address: "",
  upi_id: "",
  bank_details: "",
  client_name: "Mohit Sharma",
  client_handle: "@OkayMohit",
  client_address: "",
  client_email: "",
  payment_terms_days: 7,
  footer_note: "Thank you for working with Crazified Studios."
};
const LIMITS: Record<keyof InvoiceProfile, number> = {
  invoice_prefix: 12,
  business_name: 80, owner_name: 80, email: 120, phone: 40, address: 300, upi_id: 80, bank_details: 300,
  client_name: 80, client_handle: 60, client_address: 300, client_email: 120, payment_terms_days: 0, footer_note: 300
};
/** Merge stored details over the defaults, trimming and length-limiting every field. */
export function normalizeProfile(raw: unknown): InvoiceProfile {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PROFILE };
  for (const key of Object.keys(DEFAULT_PROFILE) as (keyof InvoiceProfile)[]) {
    if (key === "payment_terms_days") {
      const n = Number(src[key]);
      out.payment_terms_days = Number.isInteger(n) && n >= 0 && n <= 90 ? n : DEFAULT_PROFILE.payment_terms_days;
      continue;
    }
    if (typeof src[key] === "string") (out[key] as string) = (src[key] as string).replace(/\r/g, "").trim().slice(0, LIMITS[key]);
  }
  // Prefix: letters/digits in groups separated by "-", e.g. CS-MS.
  out.invoice_prefix = out.invoice_prefix.toUpperCase().replace(/[^A-Z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(out.invoice_prefix) || out.invoice_prefix.length < 2) out.invoice_prefix = DEFAULT_PROFILE.invoice_prefix;
  if (!out.business_name) out.business_name = DEFAULT_PROFILE.business_name;
  if (!out.client_name) out.client_name = DEFAULT_PROFILE.client_name;
  return out;
}

export function invoicePeriod(kind: InvoiceKind, date: string): { start: string; end: string } {
  return kind === "weekly" ? { start: mondayFor(date), end: sundayFor(date) } : { start: date, end: date };
}
/** Billed reels delivered in the period, oldest first. Reels awaiting a price are counted separately. */
export function invoiceItems(reels: Reel[], start: string, end: string): { items: InvoiceItem[]; total: number; awaitingPrice: number } {
  const inPeriod = reels.filter(r => !r.deleted_at && r.delivery_date && r.delivery_date >= start && r.delivery_date <= end && BILLED_STATES.has(r.status));
  const items = inPeriod.filter(r => reelFee(r) > 0)
    .sort((a, b) => a.delivery_date!.localeCompare(b.delivery_date!) || a.title.localeCompare(b.title))
    .map(r => ({ title: r.title.slice(0, 200), delivered: r.delivery_date!, seconds: r.duration_seconds, amount: reelFee(r) }));
  const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  return { items, total, awaitingPrice: inPeriod.filter(r => pricingState(r) === "review").length };
}
export function formatInvoiceNumber(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(2, "0")}`;
}
/** Next number in the series, e.g. CS-MS-07 after CS-MS-06. Numbers are never reused while an invoice holds them. */
export function nextInvoiceNumber(existing: string[], prefix: string): string {
  const re = new RegExp(`^${prefix.replace(/[-]/g, "\\-")}-(\\d+)$`);
  const max = existing.reduce((m, n) => { const hit = re.exec(n); return hit ? Math.max(m, Number(hit[1])) : m; }, 0);
  return formatInvoiceNumber(prefix, max + 1);
}
export function periodsOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start <= b.end && b.start <= a.end;
}
export function dueDate(issue: string, terms: number): string { return shiftISODate(issue, Math.max(0, terms)); }

export type InvoicePayState = "unpaid" | "partial" | "paid" | "void";
export function invoicePayState(total: number, paid: number, voided = false): InvoicePayState {
  if (voided) return "void";
  if (paid >= total - 0.005) return "paid";
  return paid > 0 ? "partial" : "unpaid";
}
export const payStateLabel: Record<InvoicePayState, string> = { unpaid: "Unpaid", partial: "Partially paid", paid: "Paid", void: "Void" };
/** Payments made through an invoice count for the billing week that contains the invoice period. */
export function invoiceWeekEnding(periodEnd: string): string { return sundayFor(periodEnd); }

export function periodLabel(kind: InvoiceKind, start: string, end: string, fmt: (iso: string) => string): string {
  return kind === "daily" ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

/** The date an invoice became fully paid: the payment that brought the total paid up to the invoice total. */
export function fullyPaidOn(total: number, payments: { amount: number; paid_on: string }[]): string | null {
  let sum = 0;
  for (const p of [...payments].sort((a, b) => a.paid_on.localeCompare(b.paid_on))) {
    sum += Number(p.amount);
    if (sum >= total - 0.005) return p.paid_on;
  }
  return null;
}
export type InvoiceHistoryTab = "recent" | "unpaid" | "paid" | "void";
/** Which history tab an invoice belongs to (Recent shows everything, newest first). */
export function historyTab(state: InvoicePayState): Exclude<InvoiceHistoryTab, "recent"> {
  return state === "paid" ? "paid" : state === "void" ? "void" : "unpaid";
}
