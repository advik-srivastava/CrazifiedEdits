import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { unstable_noStore as noStore } from "next/cache";
import { serviceDb } from "./supabase";
import { getReels } from "./data";
import { todayInIndia } from "./billing";
import { opaqueKey } from "./public-ledger";
import {
  dueDate, invoiceItems, invoicePayState, invoicePeriod, nextInvoiceNumber, normalizeProfile, periodsOverlap,
  type InvoiceItem, type InvoiceKind, type InvoicePayState, type InvoiceProfile
} from "./invoices";
import { renderInvoicePdf } from "./invoice-pdf";

export const INVOICE_MIGRATION_HINT = "Invoices aren't set up yet. Run sql/migrate_v1_5.sql in the Supabase SQL Editor.";

export type InvoiceRow = {
  id: string; number: string; kind: InvoiceKind; period_start: string; period_end: string; issue_date: string; due_date: string;
  items: InvoiceItem[]; item_count: number; total: number; profile: InvoiceProfile; notes: string | null; status: "issued" | "void";
  created_at: string; voided_at: string | null;
};
export type AdminInvoice = Omit<InvoiceRow, "items" | "profile"> & { paid: number; balance: number; state: InvoicePayState; payments: { id: string; amount: number; paid_on: string; method: string | null }[] };
export type PublicInvoice = { key: string; number: string; kind: InvoiceKind; period_start: string; period_end: string; issue_date: string; due_date: string; total: number; paid: number; state: InvoicePayState };

const round = (n: number) => Math.round(n * 100) / 100;

export async function getInvoiceProfile(): Promise<InvoiceProfile> {
  noStore();
  const { data } = await serviceDb().from("app_settings").select("invoice_profile").eq("id", 1).maybeSingle();
  return normalizeProfile((data as { invoice_profile?: unknown } | null)?.invoice_profile);
}
export async function saveInvoiceProfile(raw: Record<string, unknown>): Promise<void> {
  const { error } = await serviceDb().from("app_settings").update({ invoice_profile: normalizeProfile(raw) }).eq("id", 1);
  if (error) throw new Error(INVOICE_MIGRATION_HINT);
}

async function paymentsByInvoice(ids: string[]) {
  const map = new Map<string, { id: string; amount: number; paid_on: string; method: string | null }[]>();
  if (!ids.length) return map;
  const { data } = await serviceDb().from("payments").select("id,amount,paid_on,method,invoice_id").in("invoice_id", ids).order("paid_on", { ascending: true });
  for (const p of (data || []) as { id: string; amount: number; paid_on: string; method: string | null; invoice_id: string }[]) {
    map.set(p.invoice_id, [...(map.get(p.invoice_id) || []), { id: p.id, amount: Number(p.amount), paid_on: p.paid_on, method: p.method ?? null }]);
  }
  return map;
}
function summarize(row: InvoiceRow, payments: { id: string; amount: number; paid_on: string; method: string | null }[]) {
  const paid = round(payments.reduce((s, p) => s + p.amount, 0));
  const total = Number(row.total);
  return { paid, total, balance: Math.max(0, round(total - paid)), state: invoicePayState(total, paid, row.status === "void") };
}

/** Invoices for the admin, newest first, with what's been paid through each. [] before the migration. */
export async function getInvoicesForAdmin(limit = 60): Promise<AdminInvoice[]> {
  noStore();
  const { data, error } = await serviceDb().from("invoices")
    .select("id,number,kind,period_start,period_end,issue_date,due_date,item_count,total,notes,status,created_at,voided_at")
    .order("created_at", { ascending: false }).limit(limit);
  if (error || !data) return [];
  const rows = data as InvoiceRow[];
  const pays = await paymentsByInvoice(rows.map(r => r.id));
  return rows.map(r => { const p = pays.get(r.id) || []; const s = summarize(r, p); return { ...r, total: s.total, paid: s.paid, balance: s.balance, state: s.state, payments: p }; });
}
/** What the client page shows: number, period, dates, total, paid and status. No line items, notes or IDs. */
export async function getPublicInvoices(limit = 30): Promise<PublicInvoice[]> {
  noStore();
  const { data, error } = await serviceDb().from("invoices")
    .select("id,number,kind,period_start,period_end,issue_date,due_date,total,status")
    .eq("status", "issued").order("issue_date", { ascending: false }).limit(limit);
  if (error || !data) return [];
  const rows = data as InvoiceRow[];
  const pays = await paymentsByInvoice(rows.map(r => r.id));
  return rows.map(r => {
    const s = summarize(r, pays.get(r.id) || []);
    return { key: opaqueKey(r.id), number: r.number, kind: r.kind, period_start: r.period_start, period_end: r.period_end, issue_date: r.issue_date, due_date: r.due_date, total: s.total, paid: s.paid, state: s.state };
  });
}

/** Create an invoice for a week or a day. Refuses empty periods and periods already covered by another invoice. */
export async function createInvoice(kind: InvoiceKind, date: string, notes: string | null): Promise<InvoiceRow> {
  const db = serviceDb();
  const { start, end } = invoicePeriod(kind, date);
  const { data: existing, error: exErr } = await db.from("invoices").select("number,kind,period_start,period_end").eq("status", "issued")
    .lte("period_start", end).gte("period_end", start);
  if (exErr) throw new Error(INVOICE_MIGRATION_HINT);
  const clash = (existing || []).find(i => periodsOverlap({ start, end }, { start: i.period_start, end: i.period_end }));
  if (clash) throw new Error(`Invoice ${clash.number} already covers ${clash.kind === "daily" ? "that day" : "that week"}. Void it first if you want a new one, so nothing is billed twice.`);

  const { items, total, awaitingPrice } = invoiceItems(await getReels(), start, end);
  if (!items.length) throw new Error(awaitingPrice
    ? `No billable reels in this ${kind === "daily" ? "day" : "week"}: ${awaitingPrice} delivered reel${awaitingPrice === 1 ? " needs" : "s need"} a confirmed price first.`
    : `No reels were delivered in this ${kind === "daily" ? "day" : "week"}, so there's nothing to invoice.`);
  const profile = await getInvoiceProfile();
  const issue = todayInIndia();
  const year = Number(issue.slice(0, 4));
  // Sequential numbers per year. The unique constraint makes concurrent creates safe: retry with the next number.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: nums } = await db.from("invoices").select("number").like("number", `CE-${year}-%`);
    const number = nextInvoiceNumber((nums || []).map(n => n.number as string), year);
    const row = { number, kind, period_start: start, period_end: end, issue_date: issue, due_date: dueDate(issue, profile.payment_terms_days), items, item_count: items.length, total, profile, notes };
    const { data, error } = await db.from("invoices").insert(row).select("*").single();
    if (!error && data) return data as InvoiceRow;
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(/invoices/.test(error.message) ? INVOICE_MIGRATION_HINT : "Could not create the invoice.");
  }
  throw new Error("Could not create the invoice. Please try again.");
}

let fontCache: { regular: Uint8Array; bold: Uint8Array; heavy: Uint8Array; logo: Uint8Array | null } | null = null;
async function assets() {
  if (fontCache) return fontCache;
  // Literal paths so the bundler ships exactly these files with the PDF route (see next.config.ts).
  const bytes = (b: Buffer) => new Uint8Array(b);
  const [regular, bold, heavy, logo] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "assets", "fonts", "DMSans_400Regular.ttf")).then(bytes),
    fs.readFile(path.join(process.cwd(), "assets", "fonts", "DMSans_700Bold.ttf")).then(bytes),
    fs.readFile(path.join(process.cwd(), "assets", "fonts", "Manrope_800ExtraBold.ttf")).then(bytes),
    fs.readFile(path.join(process.cwd(), "public", "images", "crazified-logo.png")).then(bytes).catch(() => null)
  ]);
  fontCache = { regular, bold, heavy, logo };
  return fontCache;
}
/** The invoice as a PDF, with paid-to-date and status as of now. */
export async function invoicePdf(id: string): Promise<{ number: string; bytes: Uint8Array } | null> {
  const { data, error } = await serviceDb().from("invoices").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const row = data as InvoiceRow;
  const s = summarize(row, (await paymentsByInvoice([row.id])).get(row.id) || []);
  const bytes = await renderInvoicePdf({
    number: row.number, kind: row.kind, period_start: row.period_start, period_end: row.period_end, issue_date: row.issue_date, due_date: row.due_date,
    items: row.items, total: s.total, paid: s.paid, profile: normalizeProfile(row.profile), notes: row.notes, voided: row.status === "void"
  }, await assets());
  return { number: row.number, bytes };
}
/** True once sql/migrate_v1_5.sql has been run. */
export async function invoicesReady(): Promise<boolean> {
  const { error } = await serviceDb().from("invoices").select("id", { head: true, count: "exact" }).limit(1);
  return !error;
}
