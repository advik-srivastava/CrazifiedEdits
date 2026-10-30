"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { serviceDb, userDb } from "@/lib/supabase";
import { googleFolderId, validAmount, validDate, validDuration, validUrl, statuses, paymentMethods } from "@/lib/validation";
import { BILLED_STATES, sundayFor, todayInIndia, withinStandardLength } from "@/lib/billing";
import { syncGoogleDrive } from "@/lib/google-drive";
import type { ReelStatus } from "@/lib/models";

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
/**
 * Remove a reel from the workflow. Google Drive reels are set to Cancelled (deleting them would
 * let the next sync re-import them). Manual entries can be deleted outright.
 */
export async function removeReel(form: FormData) {
  await requireAdmin();
  let message = "";
  try {
    const id = uuid(field(form, "id"), "reel");
    const db = serviceDb();
    const { data: reel, error } = await db.from("reels").select("id,source,status").eq("id", id).single();
    if (error || !reel) throw new Error("Reel not found.");
    if (BILLED_STATES.has(reel.status)) throw new Error("Delivered reels are part of the billing record. To correct one, change its status in Edit.");
    if (reel.source === "manual") {
      const { error: delError } = await db.from("reels").delete().eq("id", id);
      if (delError) throw new Error("Unable to delete the reel.");
      message = "Manual reel deleted.";
    } else {
      const { error: upError } = await db.from("reels").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id);
      if (upError) throw new Error("Unable to cancel the reel.");
      message = "Reel cancelled. It stays out of billing and future syncs won't bill it.";
    }
  } catch (error) { fail(error); }
  success(message, "#reels");
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
  if (result.skipped) success("A sync is already running. Refresh in a minute to see the results.", "#gdrive");
  success(`Sync complete: ${result.imported} new, ${result.updated} refreshed, ${result.missing} no longer in the folder, ${result.scanned} videos scanned.`, "#gdrive");
}
export async function disconnectGoogleDrive() {
  await requireAdmin();
  try {
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
