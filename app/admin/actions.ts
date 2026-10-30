"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { serviceDb } from "@/lib/supabase";
import { googleFolderId, validDate, validDuration, validUrl, statuses } from "@/lib/validation";
import { sundayFor, todayInIndia } from "@/lib/billing";
import { syncGoogleDrive } from "@/lib/google-drive";
import type { ReelStatus } from "@/lib/models";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong";
  redirect(`/admin?error=${encodeURIComponent(message.slice(0,150))}`);
}
function success(message: string): never { revalidatePath("/admin"); revalidatePath("/"); revalidatePath("/client/[token]","page"); redirect(`/admin?success=${encodeURIComponent(message)}`); }
const field = (data:FormData, key:string) => String(data.get(key)??"").trim();
function normalizedStatus(value: string): ReelStatus {
  if (!statuses.includes(value as ReelStatus)) throw new Error("Invalid delivery status");
  return value as ReelStatus;
}

export async function saveReel(form: FormData) {
  await requireAdmin();
  try {
    const id = field(form,"id");
    const title = field(form,"title");
    const status = normalizedStatus(field(form,"status"));
    const rawDate = field(form,"delivery_date");
    const duration = validDuration(field(form,"duration_seconds"));
    const linkValue = field(form,"client_url");
    if (!id || !title || title.length > 250) throw new Error("Enter a reel title (max 250 characters).");
    if (linkValue && !validUrl(linkValue)) throw new Error("Use a valid HTTPS client-viewable link.");
    if (rawDate && !validDate(rawDate)) throw new Error("Invalid delivery date.");
    const delivery = rawDate || (["delivered","revision","approved"].includes(status) ? todayInIndia() : null);
    const {data,error} = await serviceDb().from("reels").update({
      title,status,duration_seconds:duration,delivery_date:delivery,
      client_url:validUrl(linkValue),notes:field(form,"notes").slice(0,2000),updated_at:new Date().toISOString()
    }).eq("id",id).select("id").single();
    if (error || !data) throw new Error("Unable to save the reel.");
  } catch(error) { fail(error); }
  success("Reel saved. Weekly totals have been updated.");
}
export async function addManualReel(form: FormData) {
  await requireAdmin();
  try {
    const title=field(form,"title");const url=validUrl(field(form,"drive_web_url"));
    const duration=validDuration(field(form,"duration_seconds"));
    const date=validDate(field(form,"delivery_date"));
    if (!title || title.length>250 || !url) throw new Error("A reel title and valid HTTPS Google Drive URL are required.");
    if (!date) throw new Error("Choose a valid delivery date.");
    if (duration === null) throw new Error("Enter a duration in seconds.");
    const {error}=await serviceDb().from("reels").insert({source:"manual",title,drive_web_url:url,client_url:url,
      duration_seconds:duration,status:"delivered",delivery_date:date,notes:field(form,"notes").slice(0,2000)});
    if (error) throw new Error("Could not add your reel.");
  } catch(error) {fail(error);}
  success("Reel logged and billed for its delivery week.");
}
export async function savePayment(form: FormData) {
  await requireAdmin();
  try {
    const week=field(form,"week_ending");const paid=field(form,"paid_on");const amount=Number(field(form,"amount"));
    if (!validDate(week) || sundayFor(week)!==week) throw new Error("Payment week must end on a Sunday.");
    if (!validDate(paid) || !Number.isFinite(amount) || amount<=0 || amount>100000000) throw new Error("Enter a valid payment date and positive amount.");
    const {error}=await serviceDb().from("payments").insert({week_ending:week,paid_on:paid,amount,
      note:field(form,"note").slice(0,500)});
    if (error) throw new Error("Could not record payment.");
  } catch(error) {fail(error);}
  success("Payment recorded; the remaining balance has been recalculated.");
}
export async function removePayment(form: FormData) {
  await requireAdmin();
  try {
    const id=field(form,"id");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid payment ID");
    const {error}=await serviceDb().from("payments").delete().eq("id",id);
    if(error) throw new Error("Unable to remove payment.");
  } catch(error) {fail(error);}
  success("Payment entry removed.");
}
export async function saveFolder(form: FormData) {
  await requireAdmin();
  try {
    const folder_path=googleFolderId(field(form,"folder_path"));
    const {error}=await serviceDb().from("app_settings").update({folder_path}).eq("id",1);
    if(error) throw new Error("Could not save folder path.");
  } catch(error) {fail(error);}
  success("Google Drive folder saved. Choose Sync now to import its contents.");
}
export async function syncNow() {
  await requireAdmin();
  let result;
  try {result=await syncGoogleDrive();}
  catch(error) {fail(error);}
  success(`Sync complete: ${result.imported} new, ${result.updated} refreshed, ${result.scanned} videos scanned.`);
}
export async function disconnectGoogleDrive() {
  await requireAdmin();
  try {
    const {error}=await serviceDb().from("google_drive_connection").delete().eq("id",1);
    if(error) throw new Error("Unable to disconnect Google Drive.");
  } catch(error) {fail(error);}
  success("Google Drive disconnected. Previously imported reels remain in your ledger.");
}
export async function signOut() {
  const {userDb}=await import("@/lib/supabase");
  const db=await userDb();
  await db.auth.signOut();
  redirect("/login");
}
