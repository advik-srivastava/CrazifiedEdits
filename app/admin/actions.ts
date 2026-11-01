"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { serviceDb, userDb } from "@/lib/supabase";
import { googleFolderId, validAmount, validDate, validDuration, validUrl, statuses, paymentMethods } from "@/lib/validation";
import { allowedWeeks, BILLED_STATES, prettyDate, reelWeek, shiftISODate, sundayFor, todayInIndia, withinStandardLength } from "@/lib/billing";
import { ensureDriveWatch, stopDriveWatch, syncGoogleDrive } from "@/lib/google-drive";
import type { Reel, ReelStatus } from "@/lib/models";
import { canPurge, deletePatch, isDeleted, restorePatch } from "@/lib/reel-delete";
import { createInvoice, INVOICE_MIGRATION_HINT, saveInvoiceProfile } from "@/lib/invoices-server";
import { invoiceWeekEnding } from "@/lib/invoices";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(`/admin?error=${encodeURIComponent(message.slice(0, 180))}`);
}
function success(message: string, anchor = ""): never {
  revalidatePath("/admin"); revalidatePath("/");
  redirect(`/admin?success=${encodeURIComponent(message)}${anchor}`);
}
const field = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: string, label: string): string {
  if (!UUID.test(value)) throw new Error(`Invalid ${label} ID`);
  return value;
}
function normalizedStatus(value: string): ReelStatus {
  if (!statuses.includes(value as ReelStatus)) throw new Error("Invalid delivery status");
  return value as ReelStatus;
}
/** Validate a chosen billing week: "" means the delivery week; otherwise one of the 4 weeks before it. */
function weekOverride(raw: string, delivery: string | null): string | null {
  if (!raw || !delivery) return null;
  if (!allowedWeeks(delivery).includes(raw)) throw new Error("A reel can only count in its delivery week or one of the 4 weeks before it.");
  return raw === sundayFor(delivery) ? null : raw;
}
/** Warn when a reel moves into a week that already has a weekly invoice (invoices are snapshots). */
async function invoicedWeekNote(week: string | null): Promise<string> {
  if (!week) return "";
  const { data } = await serviceDb().from("invoices").select("number").eq("status", "issued").eq("kind", "weekly").eq("period_end", week).limit(1);
  const n = data?.[0]?.number;
  return n ? ` Note: that week is already invoiced as ${n}, which doesn't include this reel. Void ${n} and generate it again to include it.` : "";
}
/** A confirmed price only applies to reels outside the standard ₹600 rule (over 60 s or unknown length). */
function confirmedPrice(raw: string, duration: number | null): number | null {
  if (!raw) return null;
  if (withinStandardLength(duration)) return null;
  return validAmount(raw, "Confirmed price");
}

export async function saveReel(form: FormData) {
  await requireAdmin();
  try {
    const id = uuid(field(form, "id"), "reel");
    const title = field(form, "title");
    const status = normalizedStatus(field(form, "status"));
    const rawDate = field(form, "delivery_date");
    const duration = validDuration(field(form, "duration_seconds"));
    const linkValue = field(form, "client_url");
    if (!title || title.length > 250) throw new Error("Enter a reel title (max 250 characters).");
    if (linkValue && !validUrl(linkValue)) throw new Error("Use a valid HTTPS client-viewable link.");
    if (rawDate && !validDate(rawDate)) throw new Error("Invalid delivery date.");
    const delivery = rawDate || (BILLED_STATES.has(status) ? todayInIndia() : null);
    const { data, error } = await serviceDb().from("reels").update({
      title, status, duration_seconds: duration, delivery_date: delivery,
      confirmed_rate_inr: confirmedPrice(field(form, "confirmed_rate_inr"), duration),
      ...(form.has("billing_week_override") ? { billing_week_override: weekOverride(field(form, "billing_week_override"), delivery) } : {}),
      client_url: validUrl(linkValue), notes: field(form, "notes").slice(0, 2000), updated_at: new Date().toISOString()
    }).eq("id", id).select("id").single();
    if (error || !data) throw new Error("Unable to save the reel. If this mentions a missing column, run sql/migrate_v1_3.sql.");
  } catch (error) { fail(error); }
  success("Reel saved. Weekly totals have been updated.", "#reels");
}
/** One-tap approval: delivered today (IST). Billing then follows the ₹600 / pricing-review rule. */
export async function markDelivered(form: FormData) {
  await requireAdmin();
  try {
    const id = uuid(field(form, "id"), "reel");
    const { data, error } = await serviceDb().from("reels")
      .update({ status: "delivered", delivery_date: todayInIndia(), updated_at: new Date().toISOString() })
      .eq("id", id).eq("status", "discovered").select("id");
    if (error) throw new Error("Unable to mark the reel delivered.");
    if (!data?.length) throw new Error("This reel was already reviewed. Refresh to see its current status.");
  } catch (error) { fail(error); }
  success("Marked delivered today. It now appears in this week's log.", "#reels");
}
const REEL_FIELDS = "id,title,source,status,status_before_removal,deleted_at,drive_missing_at";
async function loadReel(id: string) {
  const { data, error } = await serviceDb().from("reels").select(REEL_FIELDS).eq("id", id).single();
  if (error || !data) throw new Error(/deleted_at/.test(error?.message || "") ? "Run sql/migrate_v1_4.sql in Supabase to enable deleting reels." : "Reel not found.");
  return data as Pick<Reel, "id" | "title" | "source" | "status" | "status_before_removal" | "deleted_at" | "drive_missing_at">;
}
/** Delete a reel: off the delivery log, out of billing, hidden from the library. Payments are not changed. Restorable. */
export async function deleteReel(form: FormData) {
  await requireAdmin();
  let title = "";
  try {
    const reel = await loadReel(uuid(field(form, "id"), "reel"));
    if (isDeleted(reel)) throw new Error("This reel is already deleted.");
    const { error } = await serviceDb().from("reels").update(deletePatch(reel, new Date().toISOString())).eq("id", reel.id);
    if (error) throw new Error("Unable to delete the reel.");
    title = reel.title;
  } catch (error) { fail(error); }
  success(`Deleted “${title.slice(0, 60)}”. It's off the delivery log and billing. Restore it from the Deleted filter if needed.`, "#reels");
}
export async function restoreReel(form: FormData) {
  await requireAdmin();
  try {
    const reel = await loadReel(uuid(field(form, "id"), "reel"));
    if (!isDeleted(reel)) throw new Error("This reel isn't deleted.");
    const { error } = await serviceDb().from("reels").update(restorePatch(reel, new Date().toISOString())).eq("id", reel.id);
    if (error) throw new Error("Unable to restore the reel.");
  } catch (error) { fail(error); }
  success("Reel restored with its previous status and billing.", "#reels");
}
/** Permanently delete. Only for reels that can't come back via sync (manual entries, or Drive files already gone). */
export async function purgeReel(form: FormData) {
  await requireAdmin();
  try {
    const reel = await loadReel(uuid(field(form, "id"), "reel"));
    if (!canPurge(reel)) throw new Error("Delete it first. Drive videos can only be deleted permanently after the file is gone from Drive, or the next sync would bring it back.");
    const { error } = await serviceDb().from("reels").delete().eq("id", reel.id).not("deleted_at", "is", null);
    if (error) throw new Error("Unable to delete the reel permanently.");
  } catch (error) { fail(error); }
  success("Reel deleted permanently.", "#reels");
}
export async function addManualReel(form: FormData) {
  await requireAdmin();
  try {
    const title = field(form, "title"); const url = validUrl(field(form, "drive_web_url"));
    const duration = validDuration(field(form, "duration_seconds"));
    const date = validDate(field(form, "delivery_date"));
    if (!title || title.length > 250 || !url) throw new Error("A reel title and valid HTTPS Google Drive URL are required.");
    if (!date) throw new Error("Choose a valid delivery date.");
    if (duration === null) throw new Error("Enter a duration in seconds.");
    const { error } = await serviceDb().from("reels").insert({
      source: "manual", title, drive_web_url: url, client_url: url,
      duration_seconds: duration, status: "delivered", delivery_date: date, notes: field(form, "notes").slice(0, 2000)
    });
    if (error) throw new Error("Could not add your reel.");
  } catch (error) { fail(error); }
  success("Reel logged for its delivery week.", "#reels");
}
function paymentFields(form: FormData) {
  const week = field(form, "week_ending"); const paid = field(form, "paid_on");
  if (!validDate(week) || sundayFor(week) !== week) throw new Error("Payment week must end on a Sunday.");
  if (!validDate(paid)) throw new Error("Enter a valid payment date.");
  const method = field(form, "method");
  if (method && !paymentMethods.includes(method)) throw new Error("Choose a valid payment method.");
  return { week_ending: week, paid_on: paid, amount: validAmount(field(form, "amount"), "Amount"), method: method || null, note: field(form, "note").slice(0, 500) || null };
}
export async function savePayment(form: FormData) {
  await requireAdmin();
  try {
    const { method, ...base } = paymentFields(form);
    let { error } = await serviceDb().from("payments").insert({ ...base, method });
    if (error && /method/.test(error.message)) ({ error } = await serviceDb().from("payments").insert(base));
    if (error) throw new Error("Could not record payment.");
  } catch (error) { fail(error); }
  success("Payment recorded; the remaining balance has been recalculated.", "#payments");
}
export async function updatePayment(form: FormData) {
  await requireAdmin();
  try {
    const id = uuid(field(form, "id"), "payment");
    const { data, error } = await serviceDb().from("payments").update({ ...paymentFields(form), updated_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error) throw new Error("Could not correct the payment. If this mentions a missing column, run sql/migrate_v1_3.sql.");
    if (!data?.length) throw new Error("Payment not found.");
  } catch (error) { fail(error); }
  success("Payment corrected; weekly balances have been recalculated.", "#payments");
}
export async function removePayment(form: FormData) {
  await requireAdmin();
  try {
    const id = uuid(field(form, "id"), "payment");
    const { error } = await serviceDb().from("payments").delete().eq("id", id);
    if (error) throw new Error("Unable to remove payment.");
  } catch (error) { fail(error); }
  success("Payment entry removed.", "#payments");
}
export async function saveFolder(form: FormData) {
  await requireAdmin();
  try {
    const folder_path = googleFolderId(field(form, "folder_path"));
    const { error } = await serviceDb().from("app_settings").update({ folder_path }).eq("id", 1);
    if (error) throw new Error("Could not save folder path.");
  } catch (error) { fail(error); }
  success("Google Drive folder saved. Choose Sync now to import its contents.", "#gdrive");
}
export async function syncNow() {
  await requireAdmin();
  let result;
  try { result = await syncGoogleDrive("manual"); }
  catch (error) { fail(error); }
  if (result.skipped) success("A sync is already running; it will pick up any new changes. Refresh in a minute.", "#gdrive");
  if (result.warning) fail(new Error(result.warning));
  const parts = [`${result.imported} new`, result.delivered ? `${result.delivered} auto-delivered` : "", result.removed ? `${result.removed} removed (deleted from Drive)` : "", result.restored ? `${result.restored} restored` : "", `${result.scanned} videos scanned`].filter(Boolean);
  success(`Sync complete: ${parts.join(", ")}.`, "#gdrive");
}
export async function disconnectGoogleDrive() {
  await requireAdmin();
  try {
    await stopDriveWatch();
    const { error } = await serviceDb().from("google_drive_connection").delete().eq("id", 1);
    if (error) throw new Error("Unable to disconnect Google Drive.");
  } catch (error) { fail(error); }
  success("Google Drive disconnected. Previously imported reels remain in your ledger.", "#gdrive");
}
export async function signOut() {
  const db = await userDb();
  await db.auth.signOut();
  redirect("/login");
}

/** Automation switches: auto-deliver new uploads, auto-remove deleted files. */
export async function saveAutomation(form: FormData) {
  await requireAdmin();
  try {
    const autoDeliver = form.get("auto_deliver") === "on";
    const autoRemove = form.get("auto_remove") === "on";
    const db = serviceDb();
    const { data: current } = await db.from("app_settings").select("auto_deliver").eq("id", 1).single();
    // Turning auto-delivery ON only applies to uploads from now on, never to files already waiting for review.
    const patch: Record<string, unknown> = { auto_deliver: autoDeliver, auto_remove: autoRemove };
    if (autoDeliver && current?.auto_deliver === false) patch.auto_deliver_since = new Date().toISOString();
    const { error } = await db.from("app_settings").update(patch).eq("id", 1);
    if (error) throw new Error("Could not save automation settings. Run sql/migrate_v1_4.sql in Supabase.");
  } catch (error) { fail(error); }
  success("Automation settings saved.", "#gdrive");
}
/** Re-register instant change notifications with Google (normally automatic). */
export async function reconnectNotifications() {
  await requireAdmin();
  try { await ensureDriveWatch(undefined, true); }
  catch (error) { fail(error); }
  success("Instant sync is on: Google Drive will notify CrazifiedEdits of new uploads and deletions.", "#gdrive");
}

/** Confirm a client's payment report: records it as a payment for that week. */
export async function confirmClaim(form: FormData) {
  await requireAdmin();
  let amountLabel = "";
  try {
    const id = uuid(field(form, "id"), "report");
    const db = serviceDb();
    // Claim the report first, so a double click can never record the payment twice.
    const { data: claimed, error } = await db.from("payment_claims").update({ status: "confirmed", reviewed_at: new Date().toISOString() })
      .eq("id", id).eq("status", "pending").select("*");
    if (error) throw new Error("Could not confirm the report. Run sql/migrate_v1_4.sql in Supabase.");
    const claim = claimed?.[0];
    if (!claim) throw new Error("This report was already reviewed.");
    const amount = field(form, "amount") ? validAmount(field(form, "amount"), "Amount") : Number(claim.amount);
    const note = ["Reported by client", claim.reference ? `ref ${claim.reference}` : ""].filter(Boolean).join(" · ").slice(0, 500);
    const base = { week_ending: claim.week_ending, paid_on: claim.paid_on, amount, note };
    let { data: pay, error: payError } = await db.from("payments").insert({ ...base, method: claim.method }).select("id").single();
    if (payError && /method/.test(payError.message)) ({ data: pay, error: payError } = await db.from("payments").insert(base).select("id").single());
    if (payError || !pay) {
      await db.from("payment_claims").update({ status: "pending", reviewed_at: null }).eq("id", id);
      throw new Error("Could not record the payment. The report is still pending.");
    }
    await db.from("payment_claims").update({ payment_id: pay.id }).eq("id", id);
    amountLabel = `₹${amount.toLocaleString("en-IN")}`;
  } catch (error) { fail(error); }
  success(`Payment of ${amountLabel} confirmed and added to that week.`, "#claims");
}
export async function rejectClaim(form: FormData) {
  await requireAdmin();
  try {
    const id = uuid(field(form, "id"), "report");
    const { data, error } = await serviceDb().from("payment_claims")
      .update({ status: "rejected", reviewed_at: new Date().toISOString(), review_note: field(form, "review_note").slice(0, 300) || null })
      .eq("id", id).eq("status", "pending").select("id");
    if (error) throw new Error("Could not update the report.");
    if (!data?.length) throw new Error("This report was already reviewed.");
  } catch (error) { fail(error); }
  success("Report marked as not received. It isn't counted in any balance.", "#claims");
}

// ------------------------------------------------------------------ invoices
/** Generate a weekly (Mon–Sun) or daily invoice. The PDF is downloaded from the invoice list. */
export async function generateInvoice(form: FormData) {
  await requireAdmin();
  let message = "";
  try {
    const kind = field(form, "kind") === "daily" ? "daily" : "weekly";
    const date = field(form, "date") || todayInIndia();
    if (!validDate(date)) throw new Error("Choose a valid date.");
    if (date > todayInIndia() && kind === "daily") throw new Error("You can't invoice a day that hasn't happened yet.");
    const invoice = await createInvoice(kind, date, field(form, "notes").slice(0, 1000) || null);
    message = `Invoice ${invoice.number} created: ${invoice.item_count} reel${invoice.item_count === 1 ? "" : "s"}, ₹${Number(invoice.total).toLocaleString("en-IN")}.${invoice.replaced.length ? ` It replaces daily invoice${invoice.replaced.length === 1 ? "" : "s"} ${invoice.replaced.join(", ")} (now void).` : ""} Download the PDF below.`;
  } catch (error) { fail(error); }
  success(message, "#invoices");
}
/** Record money received against an invoice. It's a normal payment for the invoice's week, so the client view updates too. */
export async function recordInvoicePayment(form: FormData) {
  await requireAdmin();
  let message = "";
  try {
    const id = uuid(field(form, "id"), "invoice");
    const db = serviceDb();
    const { data: inv, error } = await db.from("invoices").select("id,number,period_end,total,status").eq("id", id).single();
    if (error || !inv) throw new Error("Invoice not found.");
    if (inv.status === "void") throw new Error("This invoice is void.");
    const { data: prior } = await db.from("payments").select("amount").eq("invoice_id", id);
    const balance = Math.round((Number(inv.total) - (prior || []).reduce((s, p) => s + Number(p.amount), 0)) * 100) / 100;
    if (balance <= 0) throw new Error(`Invoice ${inv.number} is already fully paid.`);
    const amount = field(form, "amount") ? validAmount(field(form, "amount"), "Amount") : balance;
    if (amount > balance + 0.005) throw new Error(`That's more than the ₹${balance.toLocaleString("en-IN")} still due on ${inv.number}.`);
    const paid = field(form, "paid_on") || todayInIndia();
    if (!validDate(paid)) throw new Error("Enter a valid payment date.");
    const method = field(form, "method");
    if (method && !paymentMethods.includes(method)) throw new Error("Choose a valid payment method.");
    const ref = field(form, "reference").slice(0, 120);
    const { error: payErr } = await db.from("payments").insert({
      week_ending: invoiceWeekEnding(inv.period_end), amount, paid_on: paid, method: method || null,
      note: [`Invoice ${inv.number}`, ref ? `ref ${ref}` : ""].filter(Boolean).join(" · "), invoice_id: id
    });
    if (payErr) throw new Error(/invoice_id/.test(payErr.message) ? INVOICE_MIGRATION_HINT : "Could not record the payment.");
    const left = Math.round((balance - amount) * 100) / 100;
    message = left > 0 ? `₹${amount.toLocaleString("en-IN")} recorded against ${inv.number}. ₹${left.toLocaleString("en-IN")} still due.` : `${inv.number} is now fully paid. The client view shows it as paid.`;
  } catch (error) { fail(error); }
  success(message, "#invoices");
}
/** Void an invoice (e.g. created by mistake). Only when nothing has been paid through it. Its number isn't reused. */
export async function voidInvoice(form: FormData) {
  await requireAdmin();
  try {
    const id = uuid(field(form, "id"), "invoice");
    const db = serviceDb();
    const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", id);
    if ((count ?? 0) > 0) throw new Error("Payments were recorded against this invoice. Delete those payments first, then void it.");
    const { data, error } = await db.from("invoices").update({ status: "void", voided_at: new Date().toISOString() }).eq("id", id).eq("status", "issued").select("number");
    if (error) throw new Error("Could not void the invoice.");
    if (!data?.length) throw new Error("This invoice is already void.");
  } catch (error) { fail(error); }
  success("Invoice voided. You can now create a new one for that period.", "#invoices");
}
/** Remove a void invoice that was never sent (e.g. a test). Frees its number if it was the latest one. */
export async function deleteVoidInvoice(form: FormData) {
  await requireAdmin();
  try {
    const id = uuid(field(form, "id"), "invoice");
    const db = serviceDb();
    const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", id);
    if ((count ?? 0) > 0) throw new Error("Payments are linked to this invoice, so it can't be deleted.");
    const { data, error } = await db.from("invoices").delete().eq("id", id).eq("status", "void").select("number");
    if (error) throw new Error("Could not delete the invoice.");
    if (!data?.length) throw new Error("Only void invoices can be deleted. Void it first.");
  } catch (error) { fail(error); }
  success("Void invoice deleted.", "#invoices");
}
export async function saveInvoiceDetails(form: FormData) {
  await requireAdmin();
  try {
    const raw: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") raw[k] = v;
    await saveInvoiceProfile(raw);
  } catch (error) { fail(error); }
  success("Invoice details saved. New invoices will use them.", "#invoices");
}

// ------------------------------------------------------------------ billing week & revised versions
const MIGRATION_17 = "Run sql/migrate_v1_7.sql in the Supabase SQL Editor to move reels between weeks.";
/** Count a reel in another week: "previous" (the week before its delivery week), "auto" (its delivery week) or a Sunday. */
export async function moveReelWeek(form: FormData) {
  await requireAdmin();
  let message = "";
  try {
    const id = uuid(field(form, "id"), "reel");
    const db = serviceDb();
    const { data: reel, error } = await db.from("reels").select("id,title,delivery_date,status").eq("id", id).single();
    if (error || !reel) throw new Error("Reel not found.");
    if (!reel.delivery_date || !BILLED_STATES.has(reel.status)) throw new Error("Mark the reel delivered first, then choose its billing week.");
    const target = field(form, "week");
    const week = target === "auto" ? null : target === "previous" ? shiftISODate(sundayFor(reel.delivery_date), -7) : weekOverride(target, reel.delivery_date);
    const { error: upErr } = await db.from("reels").update({ billing_week_override: week, updated_at: new Date().toISOString() }).eq("id", id);
    if (upErr) throw new Error(/billing_week_override/.test(upErr.message) ? MIGRATION_17 : "Could not change the billing week.");
    const shown = week ?? sundayFor(reel.delivery_date);
    message = `“${reel.title.slice(0, 50)}” now counts in the week ${prettyDate(shiftISODate(shown, -6))} – ${prettyDate(shown)}.` + await invoicedWeekNote(week);
  } catch (error) { fail(error); }
  success(message, "#reels");
}
/**
 * Mark a new upload as the revised version of an earlier reel (e.g. changes the client asked for).
 * The revision is delivered and counts in the ORIGINAL's billing week; the original is deleted from billing
 * (restorable), so the client is charged once.
 */
export async function markAsRevision(form: FormData) {
  await requireAdmin();
  let message = "";
  try {
    const id = uuid(field(form, "id"), "reel"), originalId = uuid(field(form, "original_id"), "original reel");
    if (id === originalId) throw new Error("A reel can't be a revision of itself.");
    const db = serviceDb();
    const { data: rows, error } = await db.from("reels").select("*").in("id", [id, originalId]);
    if (error) throw new Error("Could not load the reels.");
    const rev = (rows as Reel[]).find(r => r.id === id), orig = (rows as Reel[]).find(r => r.id === originalId);
    if (!rev || !orig) throw new Error("Reel not found.");
    if (isDeleted(orig)) throw new Error("The original reel is already deleted.");
    const today = todayInIndia();
    const delivery = rev.delivery_date || today;
    const origWeek = reelWeek(orig) ?? sundayFor(delivery);
    // The original's week must be the revision's own week or up to 4 weeks earlier.
    const week = allowedWeeks(delivery).includes(origWeek) ? (origWeek === sundayFor(delivery) ? null : origWeek) : null;
    const now = new Date().toISOString();
    const { error: e1 } = await db.from("reels").update({
      status: BILLED_STATES.has(rev.status) ? rev.status : "delivered", delivery_date: delivery, billing_week_override: week, revision_of: orig.id,
      confirmed_rate_inr: rev.confirmed_rate_inr ?? orig.confirmed_rate_inr ?? null, updated_at: now
    }).eq("id", rev.id);
    if (e1) throw new Error(/billing_week_override|revision_of/.test(e1.message) ? MIGRATION_17 : "Could not save the revision.");
    const { error: e2 } = await db.from("reels").update(deletePatch(orig, now)).eq("id", orig.id);
    if (e2) throw new Error("The revision was saved, but the original couldn't be removed from billing. Delete it manually.");
    const w = week ?? sundayFor(delivery);
    message = `Saved as the revised version of “${orig.title.slice(0, 40)}”. It counts in the week ${prettyDate(shiftISODate(w, -6))} – ${prettyDate(w)}; the original was removed from billing (restore it from Deleted if needed).`;
    const { data: inv } = await db.from("invoices").select("number").eq("status", "issued").eq("kind", "weekly").eq("period_end", w).limit(1);
    if (inv?.[0]) message += ` That week's invoice ${inv[0].number} already billed the original, so there's no extra charge.`;
  } catch (error) { fail(error); }
  success(message, "#reels");
}
