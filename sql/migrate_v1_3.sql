-- CrazifiedEdits V1.3 migration.
-- Run ONCE in the Supabase SQL Editor, after sql/schema.sql (new project) or on your existing V1.2 project.
-- Safe to re-run. ADDITIVE ONLY: no table, column or row is dropped or deleted, and existing
-- reels and payments are preserved exactly. Wrapped in a transaction: it applies fully or not at all.
BEGIN;

-- ---------------------------------------------------------------- reels
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS mime_type text;
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS drive_created_at timestamptz;   -- upload time in Google Drive
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS drive_modified_at timestamptz;
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS drive_missing_at timestamptz;   -- set when the file leaves the folder; row is kept
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS revision_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS confirmed_rate_inr numeric(12,2); -- explicit price for reels over 60 s
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS billing_week_ending date;        -- Sunday of the delivery week (maintained by trigger)

ALTER TABLE public.reels DROP CONSTRAINT IF EXISTS reels_confirmed_rate_check;
ALTER TABLE public.reels ADD CONSTRAINT reels_confirmed_rate_check CHECK (confirmed_rate_inr IS NULL OR (confirmed_rate_inr > 0 AND confirmed_rate_inr <= 10000000));
ALTER TABLE public.reels DROP CONSTRAINT IF EXISTS reels_revision_count_check;
ALTER TABLE public.reels ADD CONSTRAINT reels_revision_count_check CHECK (revision_count >= 0);

-- Billing week = the Sunday on/after the delivery date (Monday–Sunday weeks). ISODOW: Mon=1 … Sun=7.
CREATE OR REPLACE FUNCTION public.crazified_reel_before_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.billing_week_ending := CASE WHEN NEW.delivery_date IS NULL THEN NULL
    ELSE NEW.delivery_date + ((7 - EXTRACT(ISODOW FROM NEW.delivery_date)::int) % 7) END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reels_before_write ON public.reels;
CREATE TRIGGER reels_before_write BEFORE INSERT OR UPDATE ON public.reels
  FOR EACH ROW EXECUTE FUNCTION public.crazified_reel_before_write();

-- Backfill existing rows (touches only the new derived column; billing data is unchanged).
UPDATE public.reels
   SET billing_week_ending = delivery_date + ((7 - EXTRACT(ISODOW FROM delivery_date)::int) % 7)
 WHERE delivery_date IS NOT NULL AND billing_week_ending IS DISTINCT FROM delivery_date + ((7 - EXTRACT(ISODOW FROM delivery_date)::int) % 7);

CREATE INDEX IF NOT EXISTS reels_billing_week ON public.reels (billing_week_ending);
CREATE INDEX IF NOT EXISTS reels_first_seen ON public.reels (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS reels_drive_created ON public.reels (drive_created_at DESC);
CREATE INDEX IF NOT EXISTS reels_source_last_seen ON public.reels (source, last_seen_at);

-- ---------------------------------------------------------------- payments
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS method text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check CHECK (method IS NULL OR char_length(method) <= 40);
-- Payments are allocated to a Monday–Sunday week, identified by its Sunday.
-- NOT VALID: enforced for new/edited rows without failing on any unexpected legacy row.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_week_ending_sunday;
ALTER TABLE public.payments ADD CONSTRAINT payments_week_ending_sunday CHECK (EXTRACT(ISODOW FROM week_ending) = 7) NOT VALID;
CREATE INDEX IF NOT EXISTS payments_paid_on ON public.payments (paid_on DESC);

-- ---------------------------------------------------------------- sync state
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS sync_lock_until timestamptz;      -- prevents overlapping syncs
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS last_sync_started_at timestamptz;
ALTER TABLE public.google_drive_connection ADD COLUMN IF NOT EXISTS connected_by text;    -- admin who authorised Google

CREATE TABLE IF NOT EXISTS public.sync_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger text NOT NULL CHECK (trigger IN ('manual','cron')),
  status text NOT NULL CHECK (status IN ('running','success','error','skipped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  scanned integer NOT NULL DEFAULT 0 CHECK (scanned >= 0),
  imported integer NOT NULL DEFAULT 0 CHECK (imported >= 0),
  updated integer NOT NULL DEFAULT 0 CHECK (updated >= 0),
  missing integer NOT NULL DEFAULT 0 CHECK (missing >= 0),
  error text CHECK (error IS NULL OR char_length(error) <= 500)
);
CREATE INDEX IF NOT EXISTS sync_events_started ON public.sync_events (started_at DESC);

-- ---------------------------------------------------------------- security
-- Every table stays private: RLS on, no anon/authenticated policies. Only the
-- server (service role) reads or writes, and the public page gets a filtered projection.
ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_drive_connection ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sync_events FROM anon, authenticated;

COMMIT;
