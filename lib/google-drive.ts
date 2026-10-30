import "server-only";
import { decryptToken, encryptToken, randomValue, safeEqual } from "./secure";
import { getConnection, getSettings } from "./data";
import { serviceDb } from "./supabase";
import { googleFolderId } from "./google-folder";
import { FOLDER_MIME, isVideo, normalizeTitle, planRemovals, planSync, type DriveItem, type ExistingRow, type MissingRow } from "./sync-plan";
import type { Settings } from "./models";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const PROFILE_API = "https://www.googleapis.com/oauth2/v3/userinfo";
// Minimum scopes: read-only file metadata (names, links, durations) plus the account's email for display.
const SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly openid email profile";
const LOCK_MINUTES = 5;
const MIGRATION_HINT = "Run sql/migrate_v1_3.sql and sql/migrate_v1_4.sql in the Supabase SQL Editor.";

type GoogleToken = { access_token?: string; refresh_token?: string; error?: string };
type ListResponse = { files?: DriveItem[]; nextPageToken?: string; incompleteSearch?: boolean };
type Profile = { name?: string; email?: string };

export function googleConfig() {
  // Tolerate copy-paste slips: surrounding whitespace or quotes.
  const clean = (v?: string) => v?.trim().replace(/^["']|["']$/g, "").trim();
  const id = clean(process.env.GOOGLE_CLIENT_ID), secret = clean(process.env.GOOGLE_CLIENT_SECRET), redirect = clean(process.env.GOOGLE_REDIRECT_URI);
  if (!id || !secret || !redirect || id.startsWith("YOUR_") || secret.startsWith("YOUR_")) throw new Error("Google Drive OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.");
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error("GOOGLE_CLIENT_ID doesn't look like a Google OAuth Client ID (it should end in .apps.googleusercontent.com). Copy it again from Google Cloud → Google Auth Platform → Clients.");
  if (id === secret) throw new Error("GOOGLE_CLIENT_SECRET is the same as the Client ID. Paste the Client secret instead.");
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
    !(url.pathname === "/drive/v3/files" || /^\/drive\/v3\/files\/[a-zA-Z0-9_-]{18,160}$/.test(url.pathname) || url.pathname === "/oauth2/v3/userinfo" || url.pathname === "/drive/v3/changes/startPageToken")) throw new Error("Unexpected Google API endpoint.");
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

/** POST to the two Drive endpoints used for change notifications. */
async function googlePost<T>(token: string, url: URL, body: unknown): Promise<T> {
  if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com" || !["/drive/v3/changes/watch", "/drive/v3/channels/stop"].includes(url.pathname)) throw new Error("Unexpected Google API endpoint.");
  const response = await fetch(url.toString(), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (!response.ok) throw new Error(`Google Drive change notifications returned HTTP ${response.status}.`);
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export type SyncTrigger = "manual" | "cron" | "auto" | "webhook";
export type SyncResult = { scanned: number; imported: number; updated: number; missing: number; removed: number; restored: number; delivered: number; folder: string; skipped: boolean; warning: string | null };

/** Claim the sync lock so two syncs (cron, webhook, visit, Sync now) never write at the same time. */
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
  const row = { trigger, status, started_at: new Date().toISOString(), ...(status === "skipped" ? { finished_at: new Date().toISOString(), error: "Another sync was already running; it will re-check for new changes." } : {}) };
  const { data } = await serviceDb().from("sync_events").insert(row).select("id").single();
  return (data as { id: number } | null)?.id ?? null;
}
async function finishEvent(id: number | null, patch: Record<string, unknown>) {
  if (id === null) return;
  await serviceDb().from("sync_events").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id);
}
/** Ask the sync that is running now to scan once more when it finishes (changes arrived mid-scan). */
async function requestResync() {
  await serviceDb().from("app_settings").update({ resync_requested_at: new Date().toISOString() }).eq("id", 1);
}
function chunks<T>(list: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
/** Normalised titles of reels that are live (not cancelled, still in Drive): used to hold likely re-uploads for review. */
async function activeTitles(): Promise<Set<string>> {
  const db = serviceDb();
  const set = new Set<string>();
  for (let offset = 0; offset < 25000; offset += 1000) {
    const { data, error } = await db.from("reels").select("title").neq("status", "cancelled").is("drive_missing_at", null)
      .order("id", { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error(`Could not read existing reels. ${MIGRATION_HINT}`);
    for (const r of data || []) { const key = normalizeTitle(r.title); if (key) set.add(key); }
    if (!data || data.length < 1000) break;
  }
  return set;
}

export async function syncGoogleDrive(trigger: SyncTrigger = "manual", depth = 0): Promise<SyncResult> {
  const settings = await getSettings();
  if (!settings.folder_path) throw new Error("Choose a Google Drive folder before syncing.");
  const folder = googleFolderId(settings.folder_path);
  if (!(await acquireLock())) {
    await requestResync();
    await startEvent(trigger, "skipped");
    return { scanned: 0, imported: 0, updated: 0, missing: 0, removed: 0, restored: 0, delivered: 0, folder, skipped: true, warning: null };
  }
  const eventId = await startEvent(trigger, "running");
  const db = serviceDb();
  const scanStartedAt = new Date().toISOString();
  let scanned = 0, imported = 0, updated = 0, missing = 0, removed = 0, restored = 0, delivered = 0, requests = 0;
  let warning: string | null = null;
  try {
    const token = await currentAccessToken();
    const folderInfo = new URL(`${DRIVE_API}/${encodeURIComponent(folder)}`);
    folderInfo.searchParams.set("fields", "id,name,mimeType");
    folderInfo.searchParams.set("supportsAllDrives", "true");
    const folderMetadata = await googleGet<DriveItem>(token, folderInfo);
    if (folderMetadata.mimeType !== FOLDER_MIME) throw new Error("The selected Google Drive link is not a folder.");

    const options = {
      autoDeliver: settings.auto_deliver !== false, autoDeliverSince: settings.auto_deliver_since ?? null,
      folderId: folder, takenTitles: await activeTitles()
    };
    const pending = [folder], visited = new Set<string>();
    let buffer: DriveItem[] = [];
    // Writes happen in batches of 100 so sync stays fast after years of uploads.
    async function flush() {
      if (!buffer.length) return;
      const list = buffer; buffer = [];
      const ids = [...new Set(list.map(item => item.id))];
      const { data: rows, error: lookupError } = await db.from("reels")
        .select("drive_item_id,status,duration_seconds,drive_modified_at,revision_count,removed_by_sync,status_before_removal").in("drive_item_id", ids);
      if (lookupError) throw new Error(`Could not look up existing Google Drive files. ${MIGRATION_HINT}`);
      const existing = new Map((rows as ExistingRow[] || []).map(row => [row.drive_item_id, row]));
      const now = new Date().toISOString();
      const plan = planSync(list, existing, now, options);
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
      delivered += plan.autoDelivered;
      restored += plan.restored;
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

    // Only after a complete, error-free scan: handle synced files no longer in this folder
    // (deleted, trashed or moved out). Rows are never deleted: they're flagged, and with
    // auto-remove on they're cancelled, which takes them off the delivery log and out of billing.
    const { data: gone, error: goneError } = await db.from("reels").select("id,status,drive_folder_id")
      .eq("source", "google_drive").is("drive_missing_at", null).lt("last_seen_at", scanStartedAt)
      .or(`drive_folder_id.eq.${folder},drive_folder_id.is.null`);
    if (goneError) throw new Error(`Could not check for removed files. ${MIGRATION_HINT}`);
    const missingRows = (gone || []) as MissingRow[];
    if (missingRows.length) {
      const { count } = await db.from("reels").select("id", { count: "exact", head: true })
        .eq("source", "google_drive").eq("drive_folder_id", folder).neq("status", "cancelled").is("drive_missing_at", null);
      // Only reels known to belong to THIS folder can be auto-removed; older rows without a folder are just flagged.
      const inFolder = missingRows.filter(r => r.drive_folder_id === folder);
      const plan = planRemovals(inFolder, count ?? 0, settings.auto_remove !== false);
      const now = new Date().toISOString();
      for (const ids of chunks(missingRows.map(r => r.id))) {
        const { error } = await db.from("reels").update({ drive_missing_at: now }).in("id", ids);
        if (error) throw new Error("Could not flag removed files.");
      }
      for (const [status, idList] of plan.cancelByStatus) for (const ids of chunks(idList)) {
        const { error } = await db.from("reels").update({ status: "cancelled", removed_by_sync: true, status_before_removal: status, deleted_at: now, updated_at: now })
          .in("id", ids).eq("status", status);
        if (error) throw new Error("Could not remove deleted files from the delivery log.");
      }
      missing = missingRows.length; removed = plan.removed; warning = plan.warning;
    }

    const { error } = await db.from("app_settings").update({ last_sync_at: new Date().toISOString(), last_sync_count: scanned, last_sync_error: warning }).eq("id", 1);
    if (error) throw new Error("Could not save sync statistics.");
    await finishEvent(eventId, { status: "success", scanned, imported, updated, missing, removed, delivered, error: warning });
    await ensureDriveWatch(token).catch(e => console.error("Drive change notifications unavailable:", e instanceof Error ? e.message : e));
  } catch (error) {
    const msg = (error instanceof Error ? error.message : "Unknown Google Drive sync error").slice(0, 250);
    await db.from("app_settings").update({ last_sync_error: msg }).eq("id", 1);
    await finishEvent(eventId, { status: "error", scanned, imported, updated, missing, removed, delivered, error: msg });
    throw error;
  } finally {
    await releaseLock();
  }
  const result: SyncResult = { scanned, imported, updated, missing, removed, restored, delivered, folder, skipped: false, warning };
  // Changes that arrived while scanning: scan once more (at most twice per call).
  if (depth < 2) {
    const after = await getSettings().catch(() => null);
    if (after?.resync_requested_at && after.resync_requested_at > scanStartedAt) {
      await syncGoogleDrive("webhook", depth + 1).catch(() => undefined);
    }
  }
  return result;
}

/** How old the last sync may get before a dashboard visit starts a new one in the background. */
export const AUTO_SYNC_AFTER_MS = 15 * 60_000;

/**
 * Background "sync when stale": called after a dashboard page has been sent to the browser.
 * Runs at most once per 15 minutes in total (checked here, and the sync lock stops overlaps), only when
 * Google Drive is connected and a folder is chosen. A fallback for when change notifications are unavailable.
 * Never throws: failures are recorded in the sync log and shown in admin.
 */
export async function syncIfStale(now = Date.now()): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.folder_path) return;
    const last = Math.max(Date.parse(settings.last_sync_at || "") || 0, Date.parse(settings.last_sync_started_at || "") || 0);
    if (now - last < AUTO_SYNC_AFTER_MS) return;
    if (!(await getConnection())) return;
    await syncGoogleDrive("auto");
  } catch (error) {
    console.error("Automatic Google Drive sync failed:", error instanceof Error ? error.message : "Unknown error");
  }
}

// ------------------------------------------------------------------ instant sync (Drive change notifications)
const WATCH_DAYS = 7;          // Google's maximum for a changes channel.
const RENEW_WITHIN_MS = 3 * 86_400_000;
const WEBHOOK_MIN_GAP_MS = 20_000;

/** Public HTTPS address Google can call, derived from the OAuth redirect URI. Null on localhost. */
export function webhookAddress(): string | null {
  try {
    const url = new URL(googleConfig().redirect);
    if (url.protocol !== "https:" || /^(localhost|127\.)/.test(url.hostname)) return null;
    return `${url.origin}/api/gdrive/webhook`;
  } catch { return null; }
}
async function stopWatch(token: string, settings: Settings) {
  if (!settings.watch_channel_id || !settings.watch_resource_id) return;
  await googlePost(token, new URL("https://www.googleapis.com/drive/v3/channels/stop"), { id: settings.watch_channel_id, resourceId: settings.watch_resource_id }).catch(() => undefined);
}
/**
 * Make sure Google Drive notifies us of changes (new uploads, deletions) so sync runs within seconds.
 * The channel lasts at most 7 days; it's renewed whenever fewer than 3 days remain. Every sync calls this,
 * including the daily scheduled one, so it never lapses while the app is in use.
 */
export async function ensureDriveWatch(token?: string, force = false): Promise<void> {
  const address = webhookAddress();
  if (!address) return;
  const settings = await getSettings();
  const expires = Date.parse(settings.watch_expires_at || "") || 0;
  if (!force && settings.watch_channel_id && expires - Date.now() > RENEW_WITHIN_MS) return;
  const access = token ?? await currentAccessToken();
  const startUrl = new URL("https://www.googleapis.com/drive/v3/changes/startPageToken");
  startUrl.searchParams.set("supportsAllDrives", "true");
  const { startPageToken } = await googleGet<{ startPageToken: string }>(access, startUrl);
  const watchUrl = new URL("https://www.googleapis.com/drive/v3/changes/watch");
  watchUrl.searchParams.set("pageToken", startPageToken);
  watchUrl.searchParams.set("supportsAllDrives", "true");
  watchUrl.searchParams.set("includeItemsFromAllDrives", "true");
  const id = crypto.randomUUID(), secret = randomValue();
  const channel = await googlePost<{ resourceId?: string; expiration?: string }>(access, watchUrl, {
    id, type: "web_hook", address, token: secret, expiration: String(Date.now() + WATCH_DAYS * 86_400_000)
  });
  const { error } = await serviceDb().from("app_settings").update({
    watch_channel_id: id, watch_resource_id: channel.resourceId || null, watch_token: secret,
    watch_expires_at: new Date(Number(channel.expiration) || Date.now() + WATCH_DAYS * 86_400_000).toISOString()
  }).eq("id", 1);
  if (error) throw new Error(`Could not save the Drive notification channel. ${MIGRATION_HINT}`);
  await stopWatch(access, settings); // retire the previous channel only after the new one is live
}
/** Stop notifications (on disconnect). Best effort: an orphaned channel simply expires within 7 days. */
export async function stopDriveWatch(): Promise<void> {
  try {
    const settings = await getSettings();
    if (settings.watch_channel_id) await stopWatch(await currentAccessToken(), settings);
  } catch { /* token may already be gone */ }
  await serviceDb().from("app_settings").update({ watch_channel_id: null, watch_resource_id: null, watch_token: null, watch_expires_at: null }).eq("id", 1);
}
/** Check a notification really comes from our current channel. */
export async function verifyDriveNotification(channelId: string, token: string): Promise<boolean> {
  const settings = await getSettings();
  return !!settings.watch_channel_id && !!settings.watch_token &&
    safeEqual(channelId, settings.watch_channel_id) && safeEqual(token, settings.watch_token);
}
/**
 * Called (after responding to Google) for each change notification. Bursts of notifications collapse:
 * we wait until at least 20 s after the last sync started, and the sync lock turns overlapping calls
 * into a single "scan again" request.
 */
export async function syncFromNotification(): Promise<void> {
  try {
    const settings = await getSettings();
    await serviceDb().from("app_settings").update({ last_change_at: new Date().toISOString() }).eq("id", 1);
    const lastStart = Date.parse(settings.last_sync_started_at || "") || 0;
    const wait = Math.min(WEBHOOK_MIN_GAP_MS, lastStart + WEBHOOK_MIN_GAP_MS - Date.now());
    if (wait > 0) await sleep(wait);
    await syncGoogleDrive("webhook");
  } catch (error) {
    console.error("Drive change sync failed:", error instanceof Error ? error.message : "Unknown error");
  }
}
