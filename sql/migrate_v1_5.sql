-- CrazifiedEdits V1.5 migration: invoices.
-- Run ONCE in the Supabase SQL Editor AFTER migrate_v1_4.sql. Safe to re-run.
-- ADDITIVE ONLY: nothing is dropped or deleted; existing reels and payments are unchanged.
BEGIN;

-- Your business details, payment details and the client's billing details, printed on every invoice.
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS invoice_profile jsonb NOT NULL DEFAULT '{}'::jsonb;

-- An invoice is a snapshot: its reels and amounts are copied in when it's created, so later edits,
-- deletions or Drive changes never alter an invoice that was already sent.
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE CHECK (number ~ '^CE-[0-9]{4}-[0-9]{4}$'),
  kind text NOT NULL CHECK (kind IN ('weekly','daily')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,          -- [{title, delivered, seconds, amount}]
  item_count integer NOT NULL CHECK (item_count >= 0),
  total numeric(12,2) NOT NULL CHECK (total > 0 AND total <= 100000000),
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,        -- business/client details as printed
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','void')),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  CHECK (period_end >= period_start),
  CHECK (kind <> 'daily' OR period_start = period_end),
  CHECK (kind <> 'weekly' OR (period_end = period_start + 6 AND EXTRACT(ISODOW FROM period_start) = 1)),
  CHECK (due_date >= issue_date)
);
CREATE INDEX IF NOT EXISTS invoices_period ON public.invoices (period_start, period_end) WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS invoices_created ON public.invoices (created_at DESC);

-- A payment can be recorded against an invoice ("paid through invoice"). It still counts for its week.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS payments_invoice ON public.payments (invoice_id) WHERE invoice_id IS NOT NULL;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoices FROM anon, authenticated;

COMMIT;
