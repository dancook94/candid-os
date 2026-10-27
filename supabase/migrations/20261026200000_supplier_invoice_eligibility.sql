-- Let an approved administrator choose which suppliers may enter automatic
-- Gmail invoice processing. Existing suppliers stay unapproved.
-- Completed processing runs, invoices, materials, and prices are not changed.

BEGIN;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS gmail_auto_processing_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.suppliers.gmail_auto_processing_enabled IS
  'When false, stored Gmail invoices for this supplier stay available for manual classification and are not added to an automatic processing run.';

ALTER TABLE public.gmail_import_items
  ADD COLUMN IF NOT EXISTS promotion_relevance text;

ALTER TABLE public.gmail_import_items
  DROP CONSTRAINT IF EXISTS gmail_import_items_promotion_relevance_check;

ALTER TABLE public.gmail_import_items
  ADD CONSTRAINT gmail_import_items_promotion_relevance_check
  CHECK (
    promotion_relevance IS NULL
    OR promotion_relevance IN ('supplier_invoice', 'needs_review', 'irrelevant')
  );

COMMENT ON COLUMN public.gmail_import_items.promotion_relevance IS
  'supplier_invoice may enter an automatic run when the supplier is approved. needs_review waits for a person. irrelevant is excluded and the stored PDF is kept.';

DROP POLICY IF EXISTS gmail_import_items_update_admin ON public.gmail_import_items;

CREATE POLICY gmail_import_items_update_admin
  ON public.gmail_import_items FOR UPDATE TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

REVOKE ALL ON TABLE public.gmail_import_items FROM anon;

GRANT UPDATE (status, detail, promotion_relevance)
  ON public.gmail_import_items TO authenticated;

COMMIT;
