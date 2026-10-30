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
};
/** Fields that are safe to show on the public client dashboard. No internal IDs. */
export type LedgerReel = {
  key: string;
  title: string;
  source: Reel["source"];
  status: ReelStatus;
  delivery_date: string | null;
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
};
export type Connection = { id: number; account_email: string | null; account_name: string | null; refresh_token_ciphertext: string; connected_at: string; connected_by?: string | null };
export type SyncEvent = {
  id: number;
  trigger: "manual" | "cron";
  status: "running" | "success" | "error" | "skipped";
  started_at: string;
  finished_at: string | null;
  scanned: number;
  imported: number;
  updated: number;
  missing: number;
  error: string | null;
};
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
