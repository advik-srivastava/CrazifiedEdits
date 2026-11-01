export type ReelStatus = "discovered" | "delivered" | "revision" | "approved" | "cancelled";
export type Reel = {
  id: string;
  drive_item_id: string | null;
  drive_id: string | null;
  source: "google_drive" | "onedrive" | "manual";
  title: string;
  drive_web_url: string | null;
  client_url: string | null;
  duration_seconds: number | null;
  status: ReelStatus;
  delivery_date: string | null;
  notes: string | null;
  first_seen_at: string;
  last_seen_at: string | null;
  updated_at: string;
  // V1.3 columns (sql/migrate_v1_3.sql). Optional so the app still reads a V1.2 database.
  mime_type?: string | null;
  drive_created_at?: string | null;
  drive_modified_at?: string | null;
  drive_missing_at?: string | null;
  revision_count?: number | null;
  confirmed_rate_inr?: number | string | null;
  billing_week_ending?: string | null;
  // V1.4 columns (sql/migrate_v1_4.sql).
  drive_folder_id?: string | null;
  auto_delivered?: boolean | null;
  removed_by_sync?: boolean | null;
  status_before_removal?: ReelStatus | null;
  /** Set when the reel is deleted (by you, or because its file was deleted from Drive). Hidden from the library. */
  deleted_at?: string | null;
  // V1.7: count in an earlier billing week (its Sunday); revised version of another reel.
  billing_week_override?: string | null;
  revision_of?: string | null;
};
/** Fields that are safe to show on the public client dashboard. No internal IDs. */
export type LedgerReel = {
  key: string;
  title: string;
  source: Reel["source"];
  status: ReelStatus;
  delivery_date: string | null;
  /** Sunday of the billing week the reel counts in (usually the week of delivery_date). */
  week_ending: string | null;
  duration_seconds: number | null;
  confirmed_rate_inr: number | null;
  client_url: string | null;
  drive_web_url: string | null;
};
export type Payment = {
  id: string;
  week_ending: string;
  amount: number;
  paid_on: string;
  note: string | null;
  method?: string | null;
};
export type Settings = {
  id: number;
  folder_path: string;
  last_sync_at: string | null;
  last_sync_count: number | null;
  last_sync_error: string | null;
  sync_lock_until?: string | null;
  last_sync_started_at?: string | null;
  // V1.4
  auto_deliver?: boolean | null;
  auto_deliver_since?: string | null;
  auto_remove?: boolean | null;
  resync_requested_at?: string | null;
  watch_channel_id?: string | null;
  watch_resource_id?: string | null;
  watch_token?: string | null;
  watch_expires_at?: string | null;
  last_change_at?: string | null;
};
export type Connection = { id: number; account_email: string | null; account_name: string | null; refresh_token_ciphertext: string; connected_at: string; connected_by?: string | null };
export type SyncEvent = {
  id: number;
  trigger: "manual" | "cron" | "auto" | "webhook";
  status: "running" | "success" | "error" | "skipped";
  started_at: string;
  finished_at: string | null;
  scanned: number;
  imported: number;
  updated: number;
  missing: number;
  removed?: number;
  delivered?: number;
  error: string | null;
};
export type ClaimStatus = "pending" | "confirmed" | "rejected";
/** A payment the client reported from the public page. Reference, note and screenshot stay admin-only. */
export type PaymentClaim = {
  id: string;
  week_ending: string;
  amount: number;
  paid_on: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  screenshot_path: string | null;
  status: ClaimStatus;
  payment_id: string | null;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};
/** Public projection of a claim: no reference, note, screenshot or IDs. */
export type PublicClaim = { key: string; week_ending: string; amount: number; paid_on: string; status: ClaimStatus };
export type WeekPaymentStatus = "no_charges" | "unpaid" | "partial" | "paid";
export type WeekSummary = {
  ending: string;
  starting: string;
  /** Delivered reels that are billed (standard ₹600 or a confirmed price). */
  count: number;
  /** Every delivered reel in the week, including ones awaiting pricing review. */
  delivered: number;
  reviewCount: number;
  billed: number;
  received: number;
  due: number;
  reels: LedgerReel[];
  payments: Payment[];
  /** Client-reported payments awaiting confirmation (not counted in received). */
  reported: PublicClaim[];
};
export type DayActivity = {
  date: string;
  uploaded: number;
  delivered: number;
  billed: number;
  pendingReview: number;
  deliveredReels: LedgerReel[];
};
export type LedgerTotals = { delivered: number; billedReels: number; billed: number; received: number; outstanding: number; reviewCount: number };
export type PublicSyncStatus = { lastSyncedAt: string | null; healthy: boolean };

/** Admin view of a report, with a short-lived link to its private screenshot. */
export type AdminClaimView = PaymentClaim & { screenshot_url: string | null };
