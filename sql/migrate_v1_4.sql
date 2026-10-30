-- CrazifiedEdits V1.4 migration: instant Drive sync, auto-delivery, auto-removal, client payment reports.
-- Run ONCE in the Supabase SQL Editor AFTER sql/migrate_v1_3.sql. Safe to re-run.
-- ADDITIVE ONLY: nothing is dropped or deleted; existing reels and payments are unchanged.
BEGIN;

-- ---------------------------------------------------------------- settings
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS auto_deliver boolean NOT NULL DEFAULT true;
-- Only files uploaded AFTER this moment are auto-delivered, so a first sync never bills an old backlog.
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS auto_deliver_since timestamptz;
UPDATE public.app_settings SET auto_deliver_since = now() WHERE id = 1 AND auto_deliver_since IS NULL;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS auto_remove boolean NOT NULL DEFAULT true;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS resync_requested_at timestamptz;
-- Google Drive change-notification channel (renewed automatically; expires after at most 7 days).
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS watch_channel_id text;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS watch_resource_id text;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS watch_token text;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS watch_expires_at timestamptz;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS last_change_at timestamptz;

-- ---------------------------------------------------------------- reels
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS drive_folder_id text;            -- monitored folder the file was found under
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS auto_delivered boolean NOT NULL DEFAULT false;
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS removed_by_sync boolean NOT NULL DEFAULT false;
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS status_before_removal text;      -- restored if the file comes back
ALTER TABLE public.reels DROP CONSTRAINT IF EXISTS reels_status_before_removal_check;
ALTER TABLE public.reels ADD CONSTRAINT reels_status_before_removal_check
  CHECK (status_before_removal IS NULL OR status_before_removal IN ('discovered','delivered','revision','approved'));
CREATE INDEX IF NOT EXISTS reels_folder_active ON public.reels (drive_folder_id, status) WHERE source = 'google_drive';

-- ---------------------------------------------------------------- sync log
ALTER TABLE public.sync_events DROP CONSTRAINT IF EXISTS sync_events_trigger_check;
ALTER TABLE public.sync_events ADD CONSTRAINT sync_events_trigger_check CHECK (trigger IN ('manual','cron','auto','webhook'));
ALTER TABLE public.sync_events ADD COLUMN IF NOT EXISTS removed integer NOT NULL DEFAULT 0;
ALTER TABLE public.sync_events ADD COLUMN IF NOT EXISTS delivered integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------- client payment reports
CREATE TABLE IF NOT EXISTS public.payment_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_ending date NOT NULL CHECK (EXTRACT(ISODOW FROM week_ending) = 7),
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  paid_on date NOT NULL,
  method text CHECK (method IS NULL OR char_length(method) <= 40),
  reference text CHECK (reference IS NULL OR char_length(reference) <= 120),   -- private: admin only
  note text CHECK (note IS NULL OR char_length(note) <= 500),                  -- private: admin only
  screenshot_path text CHECK (screenshot_path IS NULL OR char_length(screenshot_path) <= 200), -- private storage object
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 300),
  submitter_hash text,                                                          -- hashed IP, for rate limiting only
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS payment_claims_status ON public.payment_claims (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS payment_claims_week ON public.payment_claims (week_ending);
CREATE INDEX IF NOT EXISTS payment_claims_submitter ON public.payment_claims (submitter_hash, submitted_at DESC);
ALTER TABLE public.payment_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_claims FROM anon, authenticated;

-- Private storage bucket for payment screenshots (Supabase only; skipped on plain Postgres).
-- Not public: the admin page shows each screenshot through a short-lived signed link.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('payment-proofs', 'payment-proofs', false, 4194304, ARRAY['image/jpeg','image/png','image/webp'])
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

-- ---------------------------------------------------------------- deleted reels
-- A deleted reel (by the admin, or because its file was deleted from Drive) is cancelled and hidden.
-- The row is kept so a Drive file that still exists is never re-imported and billed again.
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
UPDATE public.reels SET deleted_at = COALESCE(drive_missing_at, now()) WHERE removed_by_sync AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS reels_deleted ON public.reels (deleted_at) WHERE deleted_at IS NOT NULL;

COMMIT;
