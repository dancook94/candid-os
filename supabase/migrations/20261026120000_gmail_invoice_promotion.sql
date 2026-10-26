-- Promote stored Gmail invoice PDFs into supplier invoice review.
-- This does not change materials, supplier products, or material_prices.
-- Existing manual uploads keep source_type manual_upload and a null Gmail link.
-- Apply manually in Supabase. Do not run automatically from the app.

BEGIN;

ALTER TABLE public.supplier_invoices
  DROP CONSTRAINT IF EXISTS supplier_invoices_source_type_check;

ALTER TABLE public.supplier_invoices
  ADD CONSTRAINT supplier_invoices_source_type_check
  CHECK (source_type IN ('manual_upload', 'gmail_import'));

ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS gmail_import_item_id uuid
  REFERENCES public.gmail_import_items (id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoices_gmail_import_item_idx
  ON public.supplier_invoices (gmail_import_item_id)
  WHERE gmail_import_item_id IS NOT NULL;

COMMENT ON COLUMN public.supplier_invoices.gmail_import_item_id IS
  'Gmail discovery item promoted into review. Manual uploads leave this null.';

COMMIT;
