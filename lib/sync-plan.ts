/**
 * Pure planning logic for Google Drive sync, kept separate from network and
 * database code so its safety rules can be unit-tested:
 * - one record per Google Drive file ID (renames never create a new record);
 * - new files always start as "discovered" (pending review), never billed;
 * - sync never overwrites status, delivery date, notes, links or confirmed price;
 * - once a reel is past review, its duration is locked so later Drive revisions
 *   cannot silently change an issued bill.
 */
export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  createdTime?: string;
  modifiedTime?: string;
  videoMediaMetadata?: { durationMillis?: string };
};
export type ExistingRow = {
  drive_item_id: string;
  status: string;
  duration_seconds: number | null;
  drive_modified_at: string | null;
  revision_count: number | null;
};
export type InsertRow = {
  drive_item_id: string; source: "google_drive"; title: string; drive_web_url: string; mime_type: string | null;
  drive_created_at: string | null; drive_modified_at: string | null; duration_seconds: number | null;
  status: "discovered"; first_seen_at: string; last_seen_at: string; drive_missing_at: null; updated_at: string;
};
export type MetadataRow = {
  drive_item_id: string; source: "google_drive"; title: string; drive_web_url: string; mime_type: string | null;
  drive_created_at: string | null; drive_modified_at: string | null; last_seen_at: string; drive_missing_at: null; updated_at: string;
};
export type RowPatch = { drive_item_id: string; patch: { duration_seconds?: number; revision_count?: number } };

export const FOLDER_MIME = "application/vnd.google-apps.folder";
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

export function isVideo(item: Pick<DriveItem, "mimeType" | "name">): boolean {
  return !!item.mimeType?.startsWith("video/") || VIDEO_EXT.test(item.name || "");
}
export function driveDuration(item: DriveItem): number | null {
  const millis = Number(item.videoMediaMetadata?.durationMillis);
  return Number.isFinite(millis) && millis > 0 ? Math.min(86400, Math.ceil(millis / 1000)) : null;
}
function viewUrl(item: DriveItem): string {
  if (item.webViewLink && /^https:\/\/drive\.google\.com\//.test(item.webViewLink)) return item.webViewLink;
  return `https://drive.google.com/file/d/${encodeURIComponent(item.id)}/view`;
}
function title(item: DriveItem): string {
  const t = (item.name || "").trim().slice(0, 250);
  return t || "Untitled video";
}

export function planSync(items: DriveItem[], existing: Map<string, ExistingRow>, now: string) {
  // The same file can be listed twice (pagination overlap or nested shortcuts): last listing wins.
  const unique = new Map<string, DriveItem>();
  for (const item of items) if (item.id) unique.set(item.id, item);

  const inserts: InsertRow[] = [];
  const metadata: MetadataRow[] = [];
  const patches: RowPatch[] = [];
  for (const item of unique.values()) {
    const old = existing.get(item.id);
    const base = {
      drive_item_id: item.id, source: "google_drive" as const, title: title(item), drive_web_url: viewUrl(item),
      mime_type: item.mimeType || null, drive_created_at: item.createdTime || null, drive_modified_at: item.modifiedTime || null,
      last_seen_at: now, drive_missing_at: null, updated_at: now
    };
    const duration = driveDuration(item);
    if (!old) {
      inserts.push({ ...base, duration_seconds: duration, status: "discovered", first_seen_at: now });
      continue;
    }
    metadata.push(base);
    const patch: RowPatch["patch"] = {};
    // Fill a missing duration (Drive can take minutes to process new uploads), or refresh it while
    // the reel is still pending review. After review the duration is locked to keep bills stable.
    if (duration !== null && duration !== old.duration_seconds && (old.duration_seconds === null || old.status === "discovered")) {
      patch.duration_seconds = duration;
    }
    if (old.drive_modified_at && item.modifiedTime && Date.parse(item.modifiedTime) > Date.parse(old.drive_modified_at)) {
      patch.revision_count = (old.revision_count || 0) + 1;
    }
    if (Object.keys(patch).length) patches.push({ drive_item_id: item.id, patch });
  }
  return { inserts, metadata, patches };
}

/** Normalised title used to spot re-uploads of the same reel under a new Drive file. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase()
    .replace(/\.(mp4|mov|m4v|webm|avi|mkv)$/i, "")
    .replace(/^copy of\s+/, "")
    .replace(/\s*[-_ ]\s*copy$/, "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .trim();
}
/** Reels still pending review whose title matches another non-cancelled reel: likely re-uploads. */
export function possibleDuplicates<T extends { id: string; title: string; status: string }>(reels: T[]): Map<string, T> {
  const byTitle = new Map<string, T[]>();
  for (const r of reels) {
    if (r.status === "cancelled") continue;
    const key = normalizeTitle(r.title);
    if (!key) continue;
    byTitle.set(key, [...(byTitle.get(key) || []), r]);
  }
  const out = new Map<string, T>();
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      if (r.status !== "discovered") continue;
      const other = group.find(o => o.id !== r.id && o.status !== "discovered") || group.find(o => o.id !== r.id)!;
      out.set(r.id, other);
    }
  }
  return out;
}
