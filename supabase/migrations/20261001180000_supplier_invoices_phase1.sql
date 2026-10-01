-- Phase 1 supplier invoices: manual upload, extraction, and review.
-- This migration does not alter material_prices and does not approve prices.
-- Apply manually in Supabase.

BEGIN;

CREATE TABLE IF NOT EXISTS public.supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  raw_supplier_name text,
  invoice_number text,
  invoice_date date,
  received_at timestamptz NOT NULL DEFAULT now(),
  subtotal numeric,
  vat numeric,
  total numeric,
  currency text NOT NULL DEFAULT 'GBP',
  extraction_status text NOT NULL,
  processing_status text NOT NULL,
  source_type text NOT NULL DEFAULT 'manual_upload',
  source_identifier text,
  extraction_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_invoices_currency_gbp CHECK (currency = 'GBP'),
  CONSTRAINT supplier_invoices_source_type_check CHECK (source_type = 'manual_upload'),
  CONSTRAINT supplier_invoices_extraction_status_check CHECK (
    extraction_status IN ('extracted', 'failed', 'needs_ocr')
  ),
  CONSTRAINT supplier_invoices_processing_status_check CHECK (
    processing_status IN (
      'needs_review',
      'price_change',
      'unmatched',
      'extraction_error',
      'processed',
      'ignored'
    )
  ),
  CONSTRAINT supplier_invoices_amounts_non_negative CHECK (
    (subtotal IS NULL OR subtotal >= 0)
    AND (vat IS NULL OR vat >= 0)
    AND (total IS NULL OR total >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoices_supplier_number_idx
  ON public.supplier_invoices (supplier_id, lower(invoice_number))
  WHERE supplier_id IS NOT NULL
    AND invoice_number IS NOT NULL
    AND btrim(invoice_number) <> '';

CREATE INDEX IF NOT EXISTS supplier_invoices_created_at_idx
  ON public.supplier_invoices (created_at DESC);

DROP TRIGGER IF EXISTS supplier_invoices_set_updated_at ON public.supplier_invoices;
CREATE TRIGGER supplier_invoices_set_updated_at
  BEFORE UPDATE ON public.supplier_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE TABLE IF NOT EXISTS public.supplier_invoice_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.supplier_invoices (id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  checksum_sha256 text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_invoice_files_size_positive CHECK (byte_size > 0),
  CONSTRAINT supplier_invoice_files_checksum_length CHECK (char_length(checksum_sha256) = 64)
);

CREATE INDEX IF NOT EXISTS supplier_invoice_files_invoice_idx
  ON public.supplier_invoice_files (invoice_id);

CREATE TABLE IF NOT EXISTS public.supplier_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.supplier_invoices (id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  raw_description text NOT NULL,
  raw_supplier_sku text,
  raw_quantity numeric,
  raw_unit text,
  raw_unit_price numeric,
  raw_line_total numeric,
  raw_tax numeric,
  reviewed_description text,
  reviewed_supplier_sku text,
  reviewed_quantity numeric,
  reviewed_unit text,
  reviewed_unit_price numeric,
  reviewed_line_total numeric,
  matched_supplier_product_id uuid REFERENCES public.material_supplier_products (id) ON DELETE SET NULL,
  match_confidence text,
  match_method text,
  review_status text NOT NULL,
  maths_warning text,
  internal_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_invoice_lines_number_positive CHECK (line_number > 0),
  CONSTRAINT supplier_invoice_lines_invoice_number_unique UNIQUE (invoice_id, line_number),
  CONSTRAINT supplier_invoice_lines_description_not_blank CHECK (btrim(raw_description) <> ''),
  CONSTRAINT supplier_invoice_lines_confidence_check CHECK (
    match_confidence IS NULL OR match_confidence IN ('high', 'medium', 'low')
  ),
  CONSTRAINT supplier_invoice_lines_method_check CHECK (
    match_method IS NULL OR match_method IN (
      'sku',
      'description',
      'mapping',
      'specification',
      'fuzzy',
      'manual'
    )
  ),
  CONSTRAINT supplier_invoice_lines_status_check CHECK (
    review_status IN (
      'processed',
      'price_change',
      'needs_review',
      'unmatched',
      'ignored',
      'query',
      'extraction_error'
    )
  )
);

CREATE INDEX IF NOT EXISTS supplier_invoice_lines_invoice_idx
  ON public.supplier_invoice_lines (invoice_id, line_number);

CREATE INDEX IF NOT EXISTS supplier_invoice_lines_status_idx
  ON public.supplier_invoice_lines (review_status);

DROP TRIGGER IF EXISTS supplier_invoice_lines_set_updated_at
  ON public.supplier_invoice_lines;
CREATE TRIGGER supplier_invoice_lines_set_updated_at
  BEFORE UPDATE ON public.supplier_invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

-- Invoice wording for a product. This is not a supplier name alias.
CREATE TABLE IF NOT EXISTS public.supplier_product_description_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  normalized_description text NOT NULL,
  display_description text NOT NULL,
  material_supplier_product_id uuid NOT NULL
    REFERENCES public.material_supplier_products (id) ON DELETE RESTRICT,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_from_invoice_line_id uuid REFERENCES public.supplier_invoice_lines (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_product_description_mappings_description_not_blank CHECK (
    btrim(normalized_description) <> ''
  ),
  CONSTRAINT supplier_product_description_mappings_unique
    UNIQUE (supplier_id, normalized_description)
);

CREATE OR REPLACE FUNCTION public.supplier_product_description_mappings_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.display_description := regexp_replace(btrim(NEW.display_description), '\s+', ' ', 'g');
  NEW.normalized_description := lower(NEW.display_description);

  IF NEW.normalized_description = '' THEN
    RAISE EXCEPTION 'Invoice description is required'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.material_supplier_products AS product
    WHERE product.id = NEW.material_supplier_product_id
      AND product.supplier_id = NEW.supplier_id
  ) THEN
    RAISE EXCEPTION 'Description mapping supplier does not match the supplier product'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_product_description_mappings_check
  ON public.supplier_product_description_mappings;
CREATE TRIGGER supplier_product_description_mappings_check
  BEFORE INSERT OR UPDATE ON public.supplier_product_description_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.supplier_product_description_mappings_check();

-- Repeated non-material wording, such as carriage, for one supplier.
CREATE TABLE IF NOT EXISTS public.supplier_invoice_ignore_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  normalized_description text NOT NULL,
  display_description text NOT NULL,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_from_invoice_line_id uuid REFERENCES public.supplier_invoice_lines (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_invoice_ignore_rules_description_not_blank CHECK (
    btrim(normalized_description) <> ''
  ),
  CONSTRAINT supplier_invoice_ignore_rules_unique
    UNIQUE (supplier_id, normalized_description)
);

CREATE OR REPLACE FUNCTION public.supplier_invoice_ignore_rules_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.display_description := regexp_replace(btrim(NEW.display_description), '\s+', ' ', 'g');
  NEW.normalized_description := lower(NEW.display_description);

  IF NEW.normalized_description = '' THEN
    RAISE EXCEPTION 'Ignored description is required'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_invoice_ignore_rules_normalize
  ON public.supplier_invoice_ignore_rules;
CREATE TRIGGER supplier_invoice_ignore_rules_normalize
  BEFORE INSERT OR UPDATE ON public.supplier_invoice_ignore_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.supplier_invoice_ignore_rules_normalize();

CREATE TABLE IF NOT EXISTS public.supplier_invoice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.supplier_invoices (id) ON DELETE CASCADE,
  invoice_line_id uuid REFERENCES public.supplier_invoice_lines (id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_invoice_events_action_check CHECK (
    action IN (
      'invoice_uploaded',
      'extraction_completed',
      'extraction_failed',
      'supplier_corrected',
      'line_corrected',
      'line_added',
      'product_match_confirmed',
      'product_match_changed',
      'line_ignored',
      'line_queried',
      'description_mapping_created',
      'ignore_rule_created'
    )
  )
);

CREATE INDEX IF NOT EXISTS supplier_invoice_events_invoice_idx
  ON public.supplier_invoice_events (invoice_id, created_at DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'supplier-invoice-files',
  'supplier-invoice-files',
  false,
  15728640,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoice_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_product_description_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoice_ignore_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoice_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_invoices_select_admin ON public.supplier_invoices;
CREATE POLICY supplier_invoices_select_admin
  ON public.supplier_invoices FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoices_insert_admin ON public.supplier_invoices;
CREATE POLICY supplier_invoices_insert_admin
  ON public.supplier_invoices FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoices_update_admin ON public.supplier_invoices;
CREATE POLICY supplier_invoices_update_admin
  ON public.supplier_invoices FOR UPDATE TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoices_delete_admin ON public.supplier_invoices;
CREATE POLICY supplier_invoices_delete_admin
  ON public.supplier_invoices FOR DELETE TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_files_select_admin ON public.supplier_invoice_files;
CREATE POLICY supplier_invoice_files_select_admin
  ON public.supplier_invoice_files FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_files_insert_admin ON public.supplier_invoice_files;
CREATE POLICY supplier_invoice_files_insert_admin
  ON public.supplier_invoice_files FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_files_delete_admin ON public.supplier_invoice_files;
CREATE POLICY supplier_invoice_files_delete_admin
  ON public.supplier_invoice_files FOR DELETE TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_lines_select_admin ON public.supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_select_admin
  ON public.supplier_invoice_lines FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_lines_insert_admin ON public.supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_insert_admin
  ON public.supplier_invoice_lines FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_lines_update_admin ON public.supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_update_admin
  ON public.supplier_invoice_lines FOR UPDATE TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_lines_delete_admin ON public.supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_delete_admin
  ON public.supplier_invoice_lines FOR DELETE TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_product_description_mappings_select_admin
  ON public.supplier_product_description_mappings;
CREATE POLICY supplier_product_description_mappings_select_admin
  ON public.supplier_product_description_mappings FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_product_description_mappings_insert_admin
  ON public.supplier_product_description_mappings;
CREATE POLICY supplier_product_description_mappings_insert_admin
  ON public.supplier_product_description_mappings FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_product_description_mappings_update_admin
  ON public.supplier_product_description_mappings;
CREATE POLICY supplier_product_description_mappings_update_admin
  ON public.supplier_product_description_mappings FOR UPDATE TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_ignore_rules_select_admin
  ON public.supplier_invoice_ignore_rules;
CREATE POLICY supplier_invoice_ignore_rules_select_admin
  ON public.supplier_invoice_ignore_rules FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_ignore_rules_insert_admin
  ON public.supplier_invoice_ignore_rules;
CREATE POLICY supplier_invoice_ignore_rules_insert_admin
  ON public.supplier_invoice_ignore_rules FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_ignore_rules_update_admin
  ON public.supplier_invoice_ignore_rules;
CREATE POLICY supplier_invoice_ignore_rules_update_admin
  ON public.supplier_invoice_ignore_rules FOR UPDATE TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_events_select_admin ON public.supplier_invoice_events;
CREATE POLICY supplier_invoice_events_select_admin
  ON public.supplier_invoice_events FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_events_insert_admin ON public.supplier_invoice_events;
CREATE POLICY supplier_invoice_events_insert_admin
  ON public.supplier_invoice_events FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS supplier_invoice_files_storage_select_admin ON storage.objects;
CREATE POLICY supplier_invoice_files_storage_select_admin
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'supplier-invoice-files'
    AND public.is_approved_candid_admin()
  );

DROP POLICY IF EXISTS supplier_invoice_files_storage_insert_admin ON storage.objects;
CREATE POLICY supplier_invoice_files_storage_insert_admin
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'supplier-invoice-files'
    AND public.is_approved_candid_admin()
  );

DROP POLICY IF EXISTS supplier_invoice_files_storage_delete_admin ON storage.objects;
CREATE POLICY supplier_invoice_files_storage_delete_admin
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'supplier-invoice-files'
    AND public.is_approved_candid_admin()
  );

REVOKE ALL ON TABLE public.supplier_invoices FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.supplier_invoice_files FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.supplier_invoice_lines FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.supplier_product_description_mappings FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.supplier_invoice_ignore_rules FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.supplier_invoice_events FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_invoices TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.supplier_invoice_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_invoice_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.supplier_product_description_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.supplier_invoice_ignore_rules TO authenticated;
GRANT SELECT, INSERT ON public.supplier_invoice_events TO authenticated;

REVOKE ALL ON FUNCTION public.supplier_product_description_mappings_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.supplier_invoice_ignore_rules_normalize() FROM PUBLIC;

COMMENT ON TABLE public.supplier_invoices IS
  'Supplier invoice header. Phase 1 stores proposals and never writes material_prices.';

COMMENT ON TABLE public.supplier_product_description_mappings IS
  'Learned invoice description for one supplier product. Not a supplier name alias.';

COMMIT;
