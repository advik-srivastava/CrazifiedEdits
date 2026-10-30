import type { Reel, ReelStatus } from "./models";

/**
 * Deleting a reel in CrazifiedEdits. Rows are soft-deleted (deleted_at) rather than removed, because a
 * Google Drive file that still exists would otherwise be re-imported by the next sync and billed again.
 * A deleted reel is cancelled: off the delivery log, out of billing and hidden from the reel library.
 * Payments are never changed. It can be restored, or deleted permanently once nothing can re-import it.
 */
export const isDeleted = (r: Pick<Reel, "deleted_at">) => !!r.deleted_at;

/** Permanent deletion is only safe when no sync can bring the reel back: manual entries, or Drive files already gone. */
export function canPurge(r: Pick<Reel, "deleted_at" | "source" | "drive_missing_at">): boolean {
  return !!r.deleted_at && (r.source !== "google_drive" || !!r.drive_missing_at);
}
/** Update applied when the admin deletes a reel. `removed_by_sync: false` stops a later sync from restoring it. */
export function deletePatch(r: Pick<Reel, "status" | "status_before_removal">, now: string) {
  const previous: ReelStatus | null = r.status !== "cancelled" ? r.status : (r.status_before_removal ?? null);
  return { status: "cancelled" as const, deleted_at: now, status_before_removal: previous, removed_by_sync: false, updated_at: now };
}
/** Update applied when the admin restores a deleted reel: back to the status it had. */
export function restorePatch(r: Pick<Reel, "status_before_removal">, now: string) {
  return { status: (r.status_before_removal ?? "discovered") as ReelStatus, deleted_at: null, status_before_removal: null, removed_by_sync: false, updated_at: now };
}
