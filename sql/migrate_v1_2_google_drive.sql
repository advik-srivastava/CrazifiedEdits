-- CrazifiedEdits V1.2 upgrade for an EXISTING V1/V1.1 Supabase project.
-- Run ONCE in Supabase SQL Editor. Safe to re-run. Does not remove old OneDrive records or payment history.
BEGIN;
ALTER TABLE public.reels DROP CONSTRAINT IF EXISTS reels_source_check;
ALTER TABLE public.reels ADD CONSTRAINT reels_source_check CHECK (source IN ('google_drive','onedrive','manual'));
ALTER TABLE public.app_settings ALTER COLUMN folder_path SET DEFAULT '';
UPDATE public.app_settings SET folder_path='' WHERE folder_path='Client-Reels';
CREATE TABLE IF NOT EXISTS public.google_drive_connection (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  account_email text,
  account_name text,
  refresh_token_ciphertext text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.google_drive_connection ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated RLS policies. Server-side service role only.
COMMIT;
