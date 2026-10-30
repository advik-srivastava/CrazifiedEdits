import "server-only";
import { decryptToken, encryptToken } from "./secure";
import { getConnection, getSettings } from "./data";
import { serviceDb } from "./supabase";
import { googleFolderId } from "./google-folder";
import { FOLDER_MIME, isVideo, planSync, type DriveItem, type ExistingRow } from "./sync-plan";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const PROFILE_API = "https://www.googleapis.com/oauth2/v3/userinfo";
// Minimum scopes: read-only file metadata (names, links, durations) plus the account's email for display.
const SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly openid email profile";
const LOCK_MINUTES = 5;
const MIGRATION_HINT = "Run sql/migrate_v1_3.sql in the Supabase SQL Editor.";

type GoogleToken = { access_token?: string; refresh_token?: string; error?: string };
type ListResponse = { files?: DriveItem[]; nextPageToken?: string; incompleteSearch?: boolean };
type Profile = { name?: string; email?: string };

export function googleConfig() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim(), secret = process.env.GOOGLE_CLIENT_SECRET?.trim(), redirect = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!id || !secret || !redirect || id.startsWith("YOUR_") || secret.startsWith("YOUR_")) throw new Error("Google Drive OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.");
  if (!/^https:\/\//.test(redirect) && !/^http:\/\/localhost(?::\d+)?\//.test(redirect)) throw new Error("Google redirect URI must use HTTPS or localhost.");
  return { id, secret, redirect };
}
export function googleAuthorizeUrl(state: string, challenge: string) {
  const c = googleConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({
    client_id: c.id, redirect_uri: c.redirect, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent select_account", state, code_challenge: challenge, code_challenge_method: "S256"
  })) url.searchParams.set(key, value);
  return url.toString();
}
async function tokenRequest(fields: Record<string, string>): Promise<GoogleToken> {
  const c = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...fields }), cache: "no-store"
  });
  const data = await response.json().catch(() => ({})) as GoogleToken;
  if (!response.ok || !data.access_token) {
    if (data.error === "invalid_grant") throw new Error("Google authorization expired or was revoked. Disconnect and reconnect Google Drive in admin.");
    throw new Error(`Google authorization failed (${data.error || response.status}). Reconnect Google Drive in admin.`);
  }
  return data;
}
export async function exchangeGoogleCode(code: string, verifier: string) {
  return tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: googleConfig().redirect });
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function googleGet<T>(token: string, url: URL): Promise<T> {
  if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com" ||
    !(url.pathname === "/drive/v3/files" || /^\/drive\/v3\/files\/[a-zA-Z0-9_-]{18,160}$/.test(url.pathname) || url.pathname === "/oauth2/v3/userinfo")) throw new Error("Unexpected Google API endpoint.");
  // Retry quota (429) and temporary server errors with exponential backoff.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
    if (response.ok) return response.json() as Promise<T>;
    const retryable = response.status === 429 || response.status >= 500 ||
      (response.status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(await response.clone().text().catch(() => "")));
    if (retryable && attempt < 3) { await sleep(500 * 2 ** attempt); continue; }
    if (response.status === 429 || retryable) throw new Error("Google Drive is rate-limiting requests right now. Sync will retry on the next scheduled run.");
    if (response.status === 401) throw new Error("Google Drive authorization expired. Disconnect and reconnect Google Drive in admin.");
    if (response.status === 403) throw new Error("Google Drive denied access. Check the Drive API is enabled and the connected account can open the folder.");
    if (response.status === 404) throw new Error("Folder not found. Check the folder link and that the connected Google account has access to it.");
    throw new Error(`Google Drive returned HTTP ${response.status}. Try again or reconnect your account.`);
  }
}
export async function storeGoogleConnection(refreshToken: string, accessToken: string, connectedBy: string | null) {
  const profile = await googleGet<Profile>(accessToken, new URL(PROFILE_API));
  const row = {
    id: 1, account_email: profile.email || null, account_name: profile.name || null,
    refresh_token_ciphertext: encryptToken(refreshToken), connected_at: new Date().toISOString()
  };
  let { error } = await serviceDb().from("google_drive_connection").upsert({ ...row, connected_by: connectedBy });
  // Still works on a database where the V1.3 migration has not been run yet.
  if (error && /connected_by/.test(error.message)) ({ error } = await serviceDb().from("google_drive_connection").upsert(row));
  if (error) throw new Error("Could not store Google Drive connection. Run the SQL migrations first.");
}
async function currentAccessToken(): Promise<string> {
  const connection = await getConnection();
  if (!connection) throw new Error("Connect your Google Drive account first.");
  let refreshToken: string;
  try { refreshToken = decryptToken(connection.refresh_token_ciphertext); }
  catch { throw new Error("Stored Google token cannot be decrypted (GOOGLE_TOKEN_ENCRYPTION_KEY changed?). Reconnect Google Drive."); }
  const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (refreshed.refresh_token) {
    const { error } = await serviceDb().from("google_drive_connection").update({ refresh_token_ciphertext: encryptToken(refreshed.refresh_token) })
      .eq("id", 1).eq("refresh_token_ciphertext", connection.refresh_token_ciphertext);
    if (error) throw new Error("Could not save the renewed Google token.");
  }
  return refreshed.access_token!;
}

export type SyncTrigger = "manual" | "cron";
export type SyncResult = { scanned: number; imported: number; updated: number; missing: number; folder: string; skipped: boolean };

/** Claim the sync lock so a cron run and a manual "Sync now" never write at the same time. */
async function acquireLock(): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
  const { data, error } = await serviceDb().from("app_settings")
    .update({ sync_lock_until: until, last_sync_started_at: now.toISOString() })
    .eq("id", 1).or(`sync_lock_until.is.null,sync_lock_until.lt.${now.toISOString()}`).select("id");
  if (error) throw new Error(`Sync lock unavailable. ${MIGRATION_HINT}`);
  return !!data?.length;
}
async function releaseLock() { await serviceDb().from("app_settings").update({ sync_lock_until: null }).eq("id", 1); }
async function startEvent(trigger: SyncTrigger, status: "running" | "skipped"): Promise<number | null> {
  const row = { trigger, status, started_at: new Date().toISOString(), ...(status === "skipped" ? { finished_at: new Date().toISOString(), error: "Another sync was already running." } : {}) };
  const { data } = await serviceDb().from("sync_events").insert(row).select("id").single();
  return (data as { id: number } | null)?.id ?? null;
}
async function finishEvent(id: number | null, patch: Record<string, unknown>) {
  if (id === null) return;
  await serviceDb().from("sync_events").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id);
}

export async function syncGoogleDrive(trigger: SyncTrigger = "manual"): Promise<SyncResult> {
  const settings = await getSettings();
  if (!settings.folder_path) throw new Error("Choose a Google Drive folder before syncing.");
  const folder = googleFolderId(settings.folder_path);
  if (!(await acquireLock())) {
    await startEvent(trigger, "skipped");
    return { scanned: 0, imported: 0, updated: 0, missing: 0, folder, skipped: true };
  }
  const eventId = await startEvent(trigger, "running");
  const db = serviceDb();
  const scanStartedAt = new Date().toISOString();
  let scanned = 0, imported = 0, updated = 0, missing = 0, requests = 0;
  try {
    const token = await currentAccessToken();
    const folderInfo = new URL(`${DRIVE_API}/${encodeURIComponent(folder)}`);
    folderInfo.searchParams.set("fields", "id,name,mimeType");
    folderInfo.searchParams.set("supportsAllDrives", "true");
    const folderMetadata = await googleGet<DriveItem>(token, folderInfo);
    if (folderMetadata.mimeType !== FOLDER_MIME) throw new Error("The selected Google Drive link is not a folder.");

    const pending = [folder], visited = new Set<string>();
    let buffer: DriveItem[] = [];
    // Writes happen in batches of 100 so sync stays fast after years of uploads.
    async function flush() {
      if (!buffer.length) return;
      const list = buffer; buffer = [];
      const ids = [...new Set(list.map(item => item.id))];
      const { data: rows, error: lookupError } = await db.from("reels")
        .select("drive_item_id,status,duration_seconds,drive_modified_at,revision_count").in("drive_item_id", ids);
      if (lookupError) throw new Error(`Could not look up existing Google Drive files. ${MIGRATION_HINT}`);
      const existing = new Map((rows as ExistingRow[] || []).map(row => [row.drive_item_id, row]));
      const now = new Date().toISOString();
      const plan = planSync(list, existing, now);
      if (plan.inserts.length) {
        // ignoreDuplicates: if another writer created the row a moment ago, keep that row untouched.
        const { error } = await db.from("reels").upsert(plan.inserts, { onConflict: "drive_item_id", ignoreDuplicates: true });
        if (error) throw new Error(`Could not save new Google Drive files. ${MIGRATION_HINT}`);
      }
      if (plan.metadata.length) {
        // Metadata-only upsert: status, delivery date, notes, links and price are never in this payload.
        const { error } = await db.from("reels").upsert(plan.metadata, { onConflict: "drive_item_id" });
        if (error) throw new Error(`Could not refresh Google Drive file details. ${MIGRATION_HINT}`);
      }
      for (const { drive_item_id, patch } of plan.patches) {
        const { error } = await db.from("reels").update(patch).eq("drive_item_id", drive_item_id);
        if (error) throw new Error("Could not update a revised Google Drive file.");
      }
      imported += plan.inserts.length;
      updated += plan.metadata.length;
    }

    while (pending.length) {
      const parent = pending.shift()!;
      if (visited.has(parent)) continue;
      visited.add(parent);
      if (visited.size > 120) throw new Error("Folder tree is too large; use a smaller Google Drive folder.");
      let pageToken: string | undefined;
      do {
        if (++requests > 150) throw new Error("Drive sync request limit reached; use a smaller folder.");
        const url = new URL(DRIVE_API);
        url.searchParams.set("q", `'${parent}' in parents and trashed = false`);
        url.searchParams.set("pageSize", "200");
        url.searchParams.set("fields", "nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,createdTime,modifiedTime,videoMediaMetadata(durationMillis))");
        url.searchParams.set("supportsAllDrives", "true");
        url.searchParams.set("includeItemsFromAllDrives", "true");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const response = await googleGet<ListResponse>(token, url);
        if (response.incompleteSearch) throw new Error("Google Drive search returned incomplete results. Narrow your folder.");
        for (const item of response.files || []) {
          if (item.mimeType === FOLDER_MIME) { pending.push(item.id); continue; }
          if (!isVideo(item)) continue;
          scanned++;
          if (scanned > 10000) throw new Error("More than 10,000 videos; divide this folder into smaller collections.");
          buffer.push(item);
          if (buffer.length >= 100) await flush();
        }
        pageToken = response.nextPageToken;
      } while (pageToken);
    }
    await flush();

    // Only after a complete, error-free scan: flag synced files that are no longer in the folder
    // (deleted, trashed or moved). Records are never deleted, so issued bills stay intact.
    const { data: gone, error: missingError } = await db.from("reels").update({ drive_missing_at: new Date().toISOString() })
      .eq("source", "google_drive").is("drive_missing_at", null).lt("last_seen_at", scanStartedAt).select("id");
    if (missingError) throw new Error(`Could not flag removed files. ${MIGRATION_HINT}`);
    missing = gone?.length || 0;

    const { error } = await db.from("app_settings").update({ last_sync_at: new Date().toISOString(), last_sync_count: scanned, last_sync_error: null }).eq("id", 1);
    if (error) throw new Error("Could not save sync statistics.");
    await finishEvent(eventId, { status: "success", scanned, imported, updated, missing });
    return { scanned, imported, updated, missing, folder, skipped: false };
  } catch (error) {
    const msg = (error instanceof Error ? error.message : "Unknown Google Drive sync error").slice(0, 250);
    await db.from("app_settings").update({ last_sync_error: msg }).eq("id", 1);
    await finishEvent(eventId, { status: "error", scanned, imported, updated, missing, error: msg });
    throw error;
  } finally {
    await releaseLock();
  }
}
