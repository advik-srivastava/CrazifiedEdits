/**
 * Pure planning logic for Google Drive sync, kept separate from network and
 * database code so its safety rules can be unit-tested:
 * - one record per Google Drive file ID (renames never create a new record);
 * - new files start as "discovered" (pending review), or, when auto-delivery is on, "delivered" on
 *   their upload date (India time). Exceptions that stay pending: likely re-uploads of an existing
 *   reel, and files uploaded before auto-delivery was switched on (so a first sync never bills a backlog);
 * - a file that returns to the folder after being auto-removed gets its previous status back;
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
  removed_by_sync?: boolean | null;
  status_before_removal?: string | null;
};
export type InsertRow = {
  drive_item_id: string; source: "google_drive"; title: string; drive_web_url: string; mime_type: string | null;
  drive_created_at: string | null; drive_modified_at: string | null; duration_seconds: number | null;
  status: "discovered" | "delivered"; delivery_date: string | null; auto_delivered: boolean; drive_folder_id: string | null;
  first_seen_at: string; last_seen_at: string; drive_missing_at: null; updated_at: string;
};
export type MetadataRow = {
  drive_item_id: string; source: "google_drive"; title: string; drive_web_url: string; mime_type: string | null;
  drive_created_at: string | null; drive_modified_at: string | null; drive_folder_id: string | null; last_seen_at: string; drive_missing_at: null; updated_at: string;
};
export type RowPatch = { drive_item_id: string; patch: { duration_seconds?: number; revision_count?: number; status?: string; removed_by_sync?: boolean; status_before_removal?: null; deleted_at?: null } };

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

/** Calendar date in India for an ISO timestamp (India has no daylight saving: UTC+05:30). */
function indiaDate(iso: string): string {
  const t = Date.parse(iso);
  return new Date((Number.isFinite(t) ? t : Date.now()) + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
export type PlanOptions = {
  /** Mark brand-new uploads delivered on their upload date. */
  autoDeliver?: boolean;
  /** Only files uploaded at or after this time are auto-delivered (ISO timestamp). */
  autoDeliverSince?: string | null;
  /** Root Drive folder being monitored; stored on each reel so changing folders never removes old reels. */
  folderId?: string | null;
  /** normalizeTitle() of every active (not cancelled, still in Drive) reel. New titles are added as they're planned. */
  takenTitles?: Set<string>;
};
export function planSync(items: DriveItem[], existing: Map<string, ExistingRow>, now: string, opts: PlanOptions = {}) {
  // The same file can be listed twice (pagination overlap or nested shortcuts): last listing wins.
  const unique = new Map<string, DriveItem>();
  for (const item of items) if (item.id) unique.set(item.id, item);

  const inserts: InsertRow[] = [];
  const metadata: MetadataRow[] = [];
  const patches: RowPatch[] = [];
  let autoDelivered = 0, heldForReview = 0;
  const taken = opts.takenTitles ?? new Set<string>();
  for (const item of unique.values()) {
    const old = existing.get(item.id);
    const base = {
      drive_item_id: item.id, source: "google_drive" as const, title: title(item), drive_web_url: viewUrl(item),
      mime_type: item.mimeType || null, drive_created_at: item.createdTime || null, drive_modified_at: item.modifiedTime || null,
      drive_folder_id: opts.folderId ?? null, last_seen_at: now, drive_missing_at: null, updated_at: now
    };
    const duration = driveDuration(item);
    if (!old) {
      const key = normalizeTitle(base.title);
      const reupload = !!key && taken.has(key);
      if (key) taken.add(key);
      const uploadedAt = Date.parse(item.createdTime || now);
      const since = opts.autoDeliverSince ? Date.parse(opts.autoDeliverSince) : NaN;
      const recent = !Number.isFinite(since) || uploadedAt >= since;
      const deliver = !!opts.autoDeliver && recent && !reupload;
      if (deliver) autoDelivered++; else if (opts.autoDeliver) heldForReview++;
      inserts.push({
        ...base, duration_seconds: duration, first_seen_at: now,
        status: deliver ? "delivered" : "discovered", auto_delivered: deliver,
        delivery_date: deliver ? indiaDate(item.createdTime || now) : null
      });
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
    // The file is back in the folder (restored from trash or moved back): undo the automatic removal.
    if (old.removed_by_sync) {
      patch.status = old.status_before_removal || "discovered";
      patch.removed_by_sync = false;
      patch.status_before_removal = null;
      patch.deleted_at = null;
    }
    if (Object.keys(patch).length) patches.push({ drive_item_id: item.id, patch });
  }
  const restored = patches.filter(p => p.patch.removed_by_sync === false).length;
  return { inserts, metadata, patches, autoDelivered, heldForReview, restored };
}

export type MissingRow = { id: string; status: string; drive_folder_id: string | null };
/**
 * Decide what happens to synced reels that were NOT found in a complete scan of the folder
 * (deleted, trashed or moved out). They are always flagged as missing. With auto-remove on,
 * they are also cancelled, which takes them off the delivery log and out of billing; the
 * previous status is kept so the reel is restored if the file comes back.
 *
 * Safety guard: if one scan would remove more than 5 reels AND more than half of the folder's active
 * reels, that looks like a permissions problem or a wrong folder, not deletions. Then nothing is
 * cancelled (only flagged) and a warning is returned for the admin.
 */
export function planRemovals(missing: MissingRow[], activeInFolder: number, autoRemove: boolean) {
  const removable = missing.filter(r => r.status !== "cancelled");
  const massRemoval = removable.length > 5 && removable.length > activeInFolder / 2;
  const cancel = new Map<string, string[]>();
  if (autoRemove && !massRemoval) for (const r of removable) cancel.set(r.status, [...(cancel.get(r.status) || []), r.id]);
  return {
    flagIds: missing.map(r => r.id),
    cancelByStatus: cancel,
    removed: autoRemove && !massRemoval ? removable.length : 0,
    warning: autoRemove && massRemoval ? `${removable.length} reels disappeared from the folder in one sync, so none were removed automatically. If you really deleted them, cancel them in the reel library; otherwise check the folder link and Drive sharing.` : null
  };
}

/** Normalised title used to spot re-uploads of the same reel under a new Drive file. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase()
    .replace(/\.(mp4|mov|m4v|webm|avi|mkv)$/i, "")
    .replace(/^copy of\s+/, "")
    .replace(/\s*[-_ ]\s*copy$/, "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .trim()
    // Revision markers at the end: "v2", "rev 3", "revised", "final", "edited", "changes", "updated", "new" (repeatable).
    .replace(/(?:\s+(?:v\d+|ver\s*\d+|version\s*\d+|rev\s*\d*|revised|revision|final|edited|edit\s*\d*|changes|changed|updated|new|fixed))+$/, "")
    .trim();
}
/** Reels still pending review whose title matches another non-cancelled reel: likely re-uploads. */
export function possibleDuplicates<T extends { id: string; title: string; status: string; drive_missing_at?: string | null }>(reels: T[]): Map<string, T> {
  const byTitle = new Map<string, T[]>();
  for (const r of reels) {
    if (r.status === "cancelled" || r.drive_missing_at) continue;
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
