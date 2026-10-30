import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { serviceDb } from "./supabase";
import type { AdminClaimView, PaymentClaim, PublicClaim } from "./models";
import { extensionFor, MAX_SCREENSHOT_BYTES, sniffImage, validateClaim } from "./claims";
import { opaqueKey } from "./public-ledger";
import { unstable_noStore as noStore } from "next/cache";

export const PROOF_BUCKET = "payment-proofs";
const MIGRATION_HINT = "Payment reports aren't set up yet. Run sql/migrate_v1_4.sql in Supabase.";
const PER_HOUR = 5;
const MAX_PENDING = 30;

/** One-way hash of the visitor's IP, kept only to limit how often reports can be sent. */
function submitterHash(ip: string): string {
  return createHash("sha256").update(`crazified-claims:${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}:${ip}`).digest("hex").slice(0, 32);
}

/** Save a client's payment report and its screenshot. Throws messages that are safe to show the client. */
export async function submitClaim(form: FormData, ip: string): Promise<void> {
  const claim = validateClaim(form);
  const db = serviceDb();
  const hash = submitterHash(ip || "unknown");
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const [{ count: recent, error: e1 }, { count: pending, error: e2 }] = await Promise.all([
    db.from("payment_claims").select("id", { count: "exact", head: true }).eq("submitter_hash", hash).gte("submitted_at", hourAgo),
    db.from("payment_claims").select("id", { count: "exact", head: true }).eq("status", "pending")
  ]);
  if (e1 || e2) throw new Error(MIGRATION_HINT);
  if ((recent ?? 0) >= PER_HOUR) throw new Error("Too many reports in the last hour. Please try again later.");
  if ((pending ?? 0) >= MAX_PENDING) throw new Error("There are already many reports waiting for confirmation. Please contact Advik directly.");

  let screenshot_path: string | null = null;
  const file = form.get("screenshot");
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > MAX_SCREENSHOT_BYTES) throw new Error("The screenshot is too large (max 4 MB).");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type) throw new Error("The screenshot must be a JPG, PNG or WebP image.");
    screenshot_path = `${claim.week_ending.slice(0, 4)}/${randomUUID()}.${extensionFor[type]}`;
    const { error } = await db.storage.from(PROOF_BUCKET).upload(screenshot_path, bytes, { contentType: type, upsert: false });
    if (error) throw new Error(/bucket/i.test(error.message) ? MIGRATION_HINT : "The screenshot couldn't be uploaded. Please try again.");
  }
  const { error } = await db.from("payment_claims").insert({ ...claim, screenshot_path, submitter_hash: hash });
  if (error) {
    if (screenshot_path) await db.storage.from(PROOF_BUCKET).remove([screenshot_path]).catch(() => undefined);
    throw new Error(/payment_claims/.test(error.message) ? MIGRATION_HINT : "Your report couldn't be saved. Please try again.");
  }
}

/** Recent reports for the admin, with short-lived (10 min) links to the private screenshots. */
export async function getClaimsForAdmin(limit = 40): Promise<AdminClaimView[]> {
  noStore();
  const db = serviceDb();
  const { data, error } = await db.from("payment_claims").select("*").order("submitted_at", { ascending: false }).limit(limit);
  if (error || !data) return [];
  const claims = data as PaymentClaim[];
  const paths = claims.map(c => c.screenshot_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await db.storage.from(PROOF_BUCKET).createSignedUrls(paths, 600);
    for (const s of signed || []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return claims.map(c => ({ ...c, screenshot_url: c.screenshot_path ? urls.get(c.screenshot_path) ?? null : null }));
}
/** What the public page may show: amount, week, date and status. No reference, note, screenshot or IDs. */
export async function getPublicClaims(): Promise<PublicClaim[]> {
  noStore();
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data, error } = await serviceDb().from("payment_claims").select("id,week_ending,amount,paid_on,status")
    .in("status", ["pending", "rejected"]).gte("submitted_at", since).order("submitted_at", { ascending: false }).limit(100);
  if (error || !data) return [];
  return data.map(c => ({ key: opaqueKey(c.id), week_ending: c.week_ending, amount: Number(c.amount), paid_on: c.paid_on, status: c.status }));
}
