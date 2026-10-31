-- CrazifiedEdits V1.6 migration: CS-MS-01 style invoice numbers; weekly invoices replace daily ones.
-- Run ONCE in the Supabase SQL Editor AFTER migrate_v1_5.sql. Safe to re-run.
-- Nothing is deleted. Existing invoices keep their contents; only their number format changes.
BEGIN;

-- Numbers are PREFIX-NN, e.g. CS-MS-01 (Crazified Studios -> Mohit Sharma).
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_number_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_number_check CHECK (number ~ '^[A-Z0-9]+(-[A-Z0-9]+)*-[0-9]{2,}$');

-- Renumber invoices made with the old CE-YYYY-NNNN format into the CS-MS series, oldest first.
WITH old AS (
  SELECT id, row_number() OVER (ORDER BY created_at, number) AS rn FROM public.invoices WHERE number ~ '^CE-[0-9]{4}-[0-9]{4}$'
), base AS (
  SELECT COALESCE(MAX(substring(number FROM '([0-9]+)$')::int), 0) AS b FROM public.invoices WHERE number ~ '^CS-MS-[0-9]+$'
)
UPDATE public.invoices i SET number = 'CS-MS-' || lpad((base.b + old.rn)::text, 2, '0')
FROM old, base WHERE i.id = old.id;

-- A weekly invoice replaces any daily invoices inside its week (they're voided; payments move to the weekly one).
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

COMMIT;
