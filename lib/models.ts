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
};
export type LedgerReel = Pick<Reel, "id" | "title" | "source" | "status" | "delivery_date" | "duration_seconds" | "client_url" | "drive_web_url">;
export type Payment = {
  id: string;
  week_ending: string;
  amount: number;
  paid_on: string;
  note: string | null;
};
export type Settings = { id: number; folder_path: string; last_sync_at: string | null; last_sync_count: number | null; last_sync_error: string | null };
export type Connection = { id: number; account_email: string | null; account_name: string | null; refresh_token_ciphertext: string; connected_at: string };
export type WeekSummary = { ending: string; starting: string; count: number; billed: number; received: number; due: number; reels: LedgerReel[]; payments: Payment[] };
