-- Invoice line title/description separation and manual edit protection.
-- Apply manually in Supabase (staging first). DO NOT run automatically.
--
-- Prerequisites:
--   supabase/migrations/20260803200000_production_manifest_invoice_foundation.sql

BEGIN;

ALTER TABLE public.job_invoice_items
  ADD COLUMN IF NOT EXISTS item_name text,
  ADD COLUMN IF NOT EXISTS manually_edited boolean NOT NULL DEFAULT false;

UPDATE public.job_invoice_items
SET item_name = description
WHERE item_name IS NULL OR btrim(item_name) = '';

ALTER TABLE public.job_invoice_items
  ALTER COLUMN item_name SET NOT NULL;

ALTER TABLE public.job_invoice_items
  ALTER COLUMN description DROP NOT NULL;

ALTER TABLE public.job_invoice_items
  DROP CONSTRAINT IF EXISTS job_invoice_items_description_not_blank;

ALTER TABLE public.job_invoice_items
  DROP CONSTRAINT IF EXISTS job_invoice_items_item_name_not_blank;

ALTER TABLE public.job_invoice_items
  ADD CONSTRAINT job_invoice_items_item_name_not_blank CHECK (btrim(item_name) <> '');

COMMENT ON COLUMN public.job_invoice_items.item_name IS
  'Short invoice line title shown to admins and sent to Xero as the primary line label.';
COMMENT ON COLUMN public.job_invoice_items.description IS
  'Full invoice line description/body. May contain line breaks and structured production detail.';
COMMENT ON COLUMN public.job_invoice_items.manually_edited IS
  'When true, invoice reconciliation must not overwrite title, description, or manually entered unit price.';

COMMIT;
