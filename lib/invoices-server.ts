import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { unstable_noStore as noStore } from "next/cache";
import { serviceDb } from "./supabase";
import { getReels } from "./data";
import { todayInIndia } from "./billing";
import { opaqueKey } from "./public-ledger";
import {
  fullyPaidOn, invoiceItems, invoicePayState, invoicePeriod, nextInvoiceNumber, normalizeProfile, periodsOverlap,
  type InvoiceItem, type InvoiceKind, type InvoicePayState, type InvoiceProfile
} from "./invoices";
import { renderInvoicePdf } from "./invoice-pdf";

export const INVOICE_MIGRATION_HINT = "Invoices aren't set up yet. Run sql/migrate_v1_5.sql in the Supabase SQL Editor.";

export type InvoiceRow = {
  id: string; number: string; kind: InvoiceKind; period_start: string; period_end: string; issue_date: string; due_date: string;
  items: InvoiceItem[]; item_count: number; total: number; profile: InvoiceProfile; notes: string | null; status: "issued" | "void";
  created_at: string; voided_at: string | null; superseded_by?: string | null;
};
export type AdminInvoice = Omit<InvoiceRow, "items" | "profile"> & { replacedBy: string | null; paidOn: string | null; paid: number; balance: number; state: InvoicePayState; payments: { id: string; amount: number; paid_on: string; method: string | null }[] };
export type PublicInvoice = { key: string; number: string; kind: InvoiceKind; period_start: string; period_end: string; issue_date: string; due_date: string; total: number; paid: number; paidOn: string | null; state: InvoicePayState };

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
export async function getInvoicesForAdmin(limit = 1000): Promise<{ invoices: AdminInvoice[]; ready: boolean }> {
  noStore();
  const { data, error } = await serviceDb().from("invoices")
    .select("*")
    .order("created_at", { ascending: false }).limit(limit);
  if (error || !data) return { invoices: [], ready: false };
  const rows = data as InvoiceRow[];
  const pays = await paymentsByInvoice(rows.map(r => r.id));
  const numberOf = new Map(rows.map(r => [r.id, r.number]));
  return { ready: true, invoices: rows.map(r => { const p = pays.get(r.id) || []; const s = summarize(r, p); const { items: _i, profile: _p, ...rest } = r; void _i; void _p; return { ...rest, total: s.total, paid: s.paid, balance: s.balance, state: s.state, payments: p, paidOn: s.state === "paid" ? fullyPaidOn(s.total, p) : null, replacedBy: r.superseded_by ? numberOf.get(r.superseded_by) ?? null : null }; }) };
}
/** What the client page shows: number, period, dates, total, paid and status. No line items, notes or IDs. */
export async function getPublicInvoices(limit = 200): Promise<PublicInvoice[]> {
  noStore();
  const { data, error } = await serviceDb().from("invoices")
    .select("id,number,kind,period_start,period_end,issue_date,due_date,total,status")
    .eq("status", "issued").order("issue_date", { ascending: false }).limit(limit);
  if (error || !data) return [];
  const rows = data as InvoiceRow[];
  const pays = await paymentsByInvoice(rows.map(r => r.id));
  return rows.map(r => {
    const p = pays.get(r.id) || [];
    const s = summarize(r, p);
    return { paidOn: s.state === "paid" ? fullyPaidOn(s.total, p) : null, key: opaqueKey(r.id), number: r.number, kind: r.kind, period_start: r.period_start, period_end: r.period_end, issue_date: r.issue_date, due_date: r.due_date, total: s.total, paid: s.paid, state: s.state };
  });
}

export const NUMBER_MIGRATION_HINT = "Run sql/migrate_v1_6.sql in the Supabase SQL Editor to use CS-MS invoice numbers.";
export type CreatedInvoice = InvoiceRow & { replaced: string[] };

/**
 * Create an invoice for a week (the priority) or a day.
 * - Weekly: refused if the week already has a weekly invoice. Daily invoices inside the week are replaced:
 *   they're voided and any payments recorded against them move to the new weekly invoice (balances don't change).
 * - Daily: refused if that day is already on a weekly or daily invoice.
 * - Refuses empty periods, with a hint about reels still pending review or awaiting a price.
 */
export async function createInvoice(kind: InvoiceKind, date: string, notes: string | null): Promise<CreatedInvoice> {
  const db = serviceDb();
  const { start, end } = invoicePeriod(kind, date);
  const { data: existing, error: exErr } = await db.from("invoices").select("id,number,kind,period_start,period_end").eq("status", "issued")
    .lte("period_start", end).gte("period_end", start);
  if (exErr) throw new Error(INVOICE_MIGRATION_HINT);
  const overlapping = (existing || []).filter(i => periodsOverlap({ start, end }, { start: i.period_start, end: i.period_end }));
  const weeklyClash = overlapping.find(i => i.kind === "weekly");
  if (weeklyClash) throw new Error(kind === "weekly"
    ? `This week already has invoice ${weeklyClash.number}. Void it first if you want to make a new one.`
    : `That day is already on this week's invoice ${weeklyClash.number}.`);
  if (kind === "daily" && overlapping.length) throw new Error(`That day already has invoice ${overlapping[0].number}.`);
  const toReplace = kind === "weekly" ? overlapping.filter(i => i.kind === "daily") : [];

  const reels = await getReels();
  const { items, total, awaitingPrice } = invoiceItems(reels, start, end, kind);
  if (!items.length) {
    const where = kind === "daily" ? "on this day" : "in this week";
    const pending = reels.filter(r => !r.deleted_at && r.status === "discovered" && (r.drive_created_at || r.first_seen_at) &&
      (() => { const d = todayInIndia(new Date(r.drive_created_at || r.first_seen_at)); return d >= start && d <= end; })()).length;
    const hints = [pending ? `${pending} uploaded reel${pending === 1 ? " is" : "s are"} still pending review (mark ${pending === 1 ? "it" : "them"} delivered first)` : "",
      awaitingPrice ? `${awaitingPrice} delivered reel${awaitingPrice === 1 ? " needs" : "s need"} a confirmed price` : ""].filter(Boolean);
    throw new Error(`No billable reels were delivered ${where}${hints.length ? `: ${hints.join("; ")}.` : ", so there's nothing to invoice."}`);
  }
  const profile = await getInvoiceProfile();
  const issue = todayInIndia();
  // Sequential numbers in the prefix's series. The unique constraint makes concurrent creates safe: retry with the next number.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: nums } = await db.from("invoices").select("number").like("number", `${profile.invoice_prefix}-%`);
    const number = nextInvoiceNumber((nums || []).map(n => n.number as string), profile.invoice_prefix);
    const row = { number, kind, period_start: start, period_end: end, issue_date: issue, due_date: issue /* due the same day it is generated */, items, item_count: items.length, total, profile, notes };
    const { data, error } = await db.from("invoices").insert(row).select("*").single();
    if (!error && data) {
      const created = data as InvoiceRow;
      for (const old of toReplace) {
        const { error: payErr } = await db.from("payments").update({ invoice_id: created.id }).eq("invoice_id", old.id);
        if (payErr) throw new Error("The weekly invoice was created, but payments on the daily invoices couldn't be moved to it. Please refresh and check.");
        let { error: vErr } = await db.from("invoices").update({ status: "void", voided_at: new Date().toISOString(), superseded_by: created.id }).eq("id", old.id);
        if (vErr && /superseded_by/.test(vErr.message)) ({ error: vErr } = await db.from("invoices").update({ status: "void", voided_at: new Date().toISOString() }).eq("id", old.id));
        if (vErr) throw new Error(`The weekly invoice was created, but daily invoice ${old.number} couldn't be voided. Void it manually.`);
      }
      return { ...created, replaced: toReplace.map(o => o.number) };
    }
    if (error && /invoices_number_check|check constraint/i.test(error.message)) throw new Error(NUMBER_MIGRATION_HINT);
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
