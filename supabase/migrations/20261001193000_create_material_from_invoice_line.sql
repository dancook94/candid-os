-- Opening material, supplier product, and price from one reviewed invoice line.
-- One function, so a failure rolls the whole creation back.
-- This inserts one new material_prices row. It does not update existing prices
-- and it does not change the preferred product on any existing material.

BEGIN;

ALTER TABLE public.supplier_invoice_events
  DROP CONSTRAINT IF EXISTS supplier_invoice_events_action_check;

ALTER TABLE public.supplier_invoice_events
  ADD CONSTRAINT supplier_invoice_events_action_check CHECK (
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
      'ignore_rule_created',
      'material_created',
      'supplier_product_created',
      'opening_price_created',
      'invoice_line_resolved'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS material_prices_supplier_invoice_line_idx
  ON public.material_prices (source_reference)
  WHERE source_type = 'supplier_invoice'
    AND source_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_material_from_invoice_line(
  p_invoice_line_id uuid,
  p_name text,
  p_category text,
  p_thickness_mm numeric,
  p_colour text,
  p_finish text,
  p_purchase_unit text,
  p_purchase_width_mm numeric,
  p_purchase_height_mm numeric,
  p_purchase_length_mm numeric,
  p_supplier_id uuid,
  p_supplier_description text,
  p_supplier_sku text,
  p_price numeric,
  p_effective_date date,
  p_preferred boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_line public.supplier_invoice_lines%ROWTYPE;
  v_invoice public.supplier_invoices%ROWTYPE;
  v_identity text;
  v_material_id uuid;
  v_product_id uuid;
  v_price_id uuid;
  v_description text;
  v_statuses text[];
  v_processing text;
BEGIN
  IF NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Not allowed to create a material from an invoice'
      USING ERRCODE = '42501';
  END IF;

  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'The opening price must be greater than zero'
      USING ERRCODE = '23514';
  END IF;

  IF p_purchase_unit NOT IN ('sheet', 'roll', 'linear_metre', 'square_metre', 'unit', 'pack') THEN
    RAISE EXCEPTION 'Choose a purchase format'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_line
  FROM public.supplier_invoice_lines
  WHERE id = p_invoice_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice line not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_line.review_status NOT IN ('needs_review', 'unmatched') THEN
    RAISE EXCEPTION 'Only a needs-review or unmatched line can create a material'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.supplier_invoices
  WHERE id = v_line.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.supplier_id IS DISTINCT FROM p_supplier_id THEN
    RAISE EXCEPTION 'The supplier must be the supplier on this invoice'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.material_prices
    WHERE source_type = 'supplier_invoice'
      AND source_reference = p_invoice_line_id::text
  ) THEN
    RAISE EXCEPTION 'This invoice line has already created an opening price'
      USING ERRCODE = '23505';
  END IF;

  v_identity := public.material_identity_key(
    p_name,
    p_thickness_mm,
    p_colour,
    p_finish,
    p_purchase_unit,
    p_purchase_width_mm,
    p_purchase_height_mm,
    p_purchase_length_mm
  );

  IF EXISTS (
    SELECT 1 FROM public.materials WHERE identity_key = v_identity
  ) THEN
    RAISE EXCEPTION 'A material with this name and specification already exists'
      USING ERRCODE = '23505';
  END IF;

  IF NULLIF(btrim(COALESCE(p_supplier_sku, '')), '') IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.material_supplier_products
    WHERE supplier_id = p_supplier_id
      AND lower(supplier_sku) = lower(btrim(p_supplier_sku))
  ) THEN
    RAISE EXCEPTION 'This supplier already has that SKU'
      USING ERRCODE = '23505';
  END IF;

  v_description := lower(regexp_replace(btrim(p_supplier_description), '\s+', ' ', 'g'));

  IF EXISTS (
    SELECT 1
    FROM public.material_supplier_products
    WHERE supplier_id = p_supplier_id
      AND normalized_description = v_description
  ) THEN
    RAISE EXCEPTION 'This supplier already has that product description'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.materials (
    name,
    category,
    thickness_mm,
    colour,
    finish,
    purchase_unit,
    purchase_width_mm,
    purchase_height_mm,
    purchase_length_mm,
    identity_key,
    active
  )
  VALUES (
    p_name,
    NULLIF(btrim(COALESCE(p_category, '')), ''),
    p_thickness_mm,
    NULLIF(btrim(COALESCE(p_colour, '')), ''),
    NULLIF(btrim(COALESCE(p_finish, '')), ''),
    p_purchase_unit,
    p_purchase_width_mm,
    p_purchase_height_mm,
    p_purchase_length_mm,
    v_identity,
    true
  )
  RETURNING id INTO v_material_id;

  INSERT INTO public.material_supplier_products (
    material_id,
    supplier_id,
    supplier_sku,
    supplier_description,
    normalized_description,
    is_preferred,
    active
  )
  VALUES (
    v_material_id,
    p_supplier_id,
    NULLIF(btrim(COALESCE(p_supplier_sku, '')), ''),
    p_supplier_description,
    v_description,
    COALESCE(p_preferred, true),
    true
  )
  RETURNING id INTO v_product_id;

  INSERT INTO public.material_prices (
    material_supplier_product_id,
    price,
    currency,
    price_unit,
    effective_date,
    approved_by,
    source_type,
    source_reference
  )
  VALUES (
    v_product_id,
    p_price,
    'GBP',
    p_purchase_unit,
    p_effective_date,
    auth.uid(),
    'supplier_invoice',
    p_invoice_line_id::text
  )
  RETURNING id INTO v_price_id;

  INSERT INTO public.supplier_product_description_mappings (
    supplier_id,
    display_description,
    normalized_description,
    material_supplier_product_id,
    created_by,
    created_from_invoice_line_id
  )
  VALUES (
    p_supplier_id,
    v_line.raw_description,
    lower(v_line.raw_description),
    v_product_id,
    auth.uid(),
    v_line.id
  );

  UPDATE public.supplier_invoice_lines
  SET
    matched_supplier_product_id = v_product_id,
    match_confidence = 'high',
    match_method = 'manual',
    review_status = 'processed'
  WHERE id = v_line.id;

  INSERT INTO public.supplier_invoice_events (invoice_id, invoice_line_id, actor_id, action, metadata)
  VALUES
    (v_invoice.id, v_line.id, auth.uid(), 'material_created', jsonb_build_object('materialId', v_material_id, 'name', p_name)),
    (v_invoice.id, v_line.id, auth.uid(), 'supplier_product_created', jsonb_build_object('productId', v_product_id, 'sku', p_supplier_sku)),
    (v_invoice.id, v_line.id, auth.uid(), 'opening_price_created', jsonb_build_object('priceId', v_price_id, 'price', p_price, 'priceUnit', p_purchase_unit)),
    (v_invoice.id, v_line.id, auth.uid(), 'description_mapping_created', jsonb_build_object('description', v_line.raw_description, 'productId', v_product_id)),
    (v_invoice.id, v_line.id, auth.uid(), 'invoice_line_resolved', jsonb_build_object('productId', v_product_id));

  SELECT array_agg(review_status)
  INTO v_statuses
  FROM public.supplier_invoice_lines
  WHERE invoice_id = v_invoice.id;

  v_processing := CASE
    WHEN v_invoice.extraction_status <> 'extracted' OR v_statuses IS NULL THEN 'extraction_error'
    WHEN 'extraction_error' = ANY (v_statuses) THEN 'extraction_error'
    WHEN 'unmatched' = ANY (v_statuses) THEN 'unmatched'
    WHEN 'needs_review' = ANY (v_statuses) OR 'query' = ANY (v_statuses) THEN 'needs_review'
    WHEN 'price_change' = ANY (v_statuses) THEN 'price_change'
    WHEN NOT EXISTS (
      SELECT 1
      FROM unnest(v_statuses) AS status
      WHERE status <> 'ignored'
    ) THEN 'ignored'
    ELSE 'processed'
  END;

  UPDATE public.supplier_invoices
  SET processing_status = v_processing
  WHERE id = v_invoice.id;

  RETURN jsonb_build_object(
    'materialId', v_material_id,
    'productId', v_product_id,
    'priceId', v_price_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_material_from_invoice_line(
  uuid, text, text, numeric, text, text, text, numeric, numeric, numeric, uuid, text, text, numeric, date, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_material_from_invoice_line(
  uuid, text, text, numeric, text, text, text, numeric, numeric, numeric, uuid, text, text, numeric, date, boolean
) TO authenticated;

COMMIT;
