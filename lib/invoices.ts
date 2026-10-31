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
  business_name: "Crazified Studios",
  owner_name: "Advik",
  email: "",
  phone: "",
  address: "",
  upi_id: "",
  bank_details: "",
  client_name: "Mohit",
  client_handle: "@OkayMohit",
  client_address: "",
  client_email: "",
  payment_terms_days: 7,
  footer_note: "Thank you for working with Crazified Studios."
};
const LIMITS: Record<keyof InvoiceProfile, number> = {
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
export function formatInvoiceNumber(year: number, n: number): string {
  return `CE-${year}-${String(n).padStart(4, "0")}`;
}
/** Next sequential number for the year, e.g. CE-2026-0007 after CE-2026-0006. Numbers are never reused. */
export function nextInvoiceNumber(existing: string[], year: number): string {
  const prefix = `CE-${year}-`;
  const max = existing.filter(n => n.startsWith(prefix)).reduce((m, n) => Math.max(m, Number(n.slice(prefix.length)) || 0), 0);
  return formatInvoiceNumber(year, max + 1);
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
