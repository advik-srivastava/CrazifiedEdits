-- CrazifiedEdits V1.7 migration: count a reel in an earlier billing week; revised versions.
-- Run ONCE in the Supabase SQL Editor AFTER migrate_v1_6.sql. Safe to re-run. Nothing is deleted.
BEGIN;

-- Count a reel in a different (earlier) Monday–Sunday week than its delivery date, e.g. changes the client
-- asked for on Monday to a reel delivered the previous week. Stored as that week's Sunday.
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS billing_week_override date;
ALTER TABLE public.reels DROP CONSTRAINT IF EXISTS reels_billing_week_override_sunday;
ALTER TABLE public.reels ADD CONSTRAINT reels_billing_week_override_sunday
  CHECK (billing_week_override IS NULL OR EXTRACT(ISODOW FROM billing_week_override) = 7);

-- A revised upload can point to the reel it replaces (the original is then deleted from billing, restorable).
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS revision_of uuid REFERENCES public.reels(id) ON DELETE SET NULL;
ALTER TABLE public.reels DROP CONSTRAINT IF EXISTS reels_revision_not_self;
ALTER TABLE public.reels ADD CONSTRAINT reels_revision_not_self CHECK (revision_of IS NULL OR revision_of <> id);

-- billing_week_ending now honours the override.
CREATE OR REPLACE FUNCTION public.crazified_reel_before_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.billing_week_ending := CASE
    WHEN NEW.delivery_date IS NULL THEN NULL
    WHEN NEW.billing_week_override IS NOT NULL THEN NEW.billing_week_override
    ELSE NEW.delivery_date + ((7 - EXTRACT(ISODOW FROM NEW.delivery_date)::int) % 7) END;
  RETURN NEW;
END $$;

COMMIT;
