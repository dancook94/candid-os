-- Retain the current approved price for an older invoice line.
-- This inserts one audit event and marks that line processed.
-- It does not insert, update, or delete material_prices.
-- Apply manually to the Test project only. Do not push this from config.toml.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_events_one_historical_price_idx
  ON public.supplier_invoice_events (invoice_line_id)
  WHERE invoice_line_id IS NOT NULL
    AND action = 'price_change_rejected'
    AND metadata->>'rule' = 'historical_price';

CREATE OR REPLACE FUNCTION public.retain_historical_invoice_price(
  p_invoice_line_id uuid,
  p_expected_product_id uuid,
  p_expected_price_id uuid,
  p_expected_invoice_price numeric,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_line public.supplier_invoice_lines%ROWTYPE;
  v_invoice public.supplier_invoices%ROWTYPE;
  v_product public.material_supplier_products%ROWTYPE;
  v_material_unit text;
  v_unit text;
  v_invoice_price numeric;
  v_current public.material_prices%ROWTYPE;
  v_latest_date date;
  v_latest_count integer;
  v_invoice_sku text;
  v_product_sku text;
  v_description text;
  v_description_count integer;
  v_sku_count integer;
  v_reason text := 'The invoice date is before the current approved price effective date, so the current price was retained.';
  v_statuses text[];
  v_processing text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Not allowed to retain an invoice price'
      USING ERRCODE = '42501';
  END IF;

  IF auth.role() = 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = p_actor_id
        AND account_status = 'approved'
        AND user_role IN ('super_admin', 'admin')
    ) THEN
      RAISE EXCEPTION 'The processing owner is not an approved administrator'
        USING ERRCODE = '42501';
    END IF;
  ELSIF auth.uid() IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'The price decision must be recorded against the signed-in administrator'
      USING ERRCODE = '42501';
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

  SELECT *
  INTO v_invoice
  FROM public.supplier_invoices
  WHERE id = v_line.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.processing_status = 'ignored' THEN
    RAISE EXCEPTION 'An ignored invoice cannot receive an automatic price decision'
      USING ERRCODE = '23514';
  END IF;

  IF v_line.review_status = 'processed' AND EXISTS (
    SELECT 1
    FROM public.supplier_invoice_events
    WHERE invoice_line_id = v_line.id
      AND action = 'price_change_rejected'
      AND metadata->>'rule' = 'historical_price'
  ) THEN
    RETURN jsonb_build_object(
      'alreadyResolved', true,
      'decision', 'keep',
      'rule', 'historical_price'
    );
  END IF;

  IF v_line.review_status IS DISTINCT FROM 'price_change' THEN
    RAISE EXCEPTION 'Only a price-change line can retain the current price'
      USING ERRCODE = '23514';
  END IF;

  IF v_invoice.extraction_status IS DISTINCT FROM 'extracted'
    OR NULLIF(btrim(COALESCE(v_line.maths_warning, '')), '') IS NOT NULL
  THEN
    RAISE EXCEPTION 'The invoice extraction is not reliable enough for an automatic price decision'
      USING ERRCODE = '23514';
  END IF;

  IF v_invoice.invoice_date IS NULL THEN
    RAISE EXCEPTION 'The invoice needs a reliable date before the current price can be retained'
      USING ERRCODE = '23514';
  END IF;

  IF v_line.match_confidence IS DISTINCT FROM 'high'
    OR v_line.match_method NOT IN ('sku', 'description', 'mapping')
    OR v_line.matched_supplier_product_id IS DISTINCT FROM p_expected_product_id
  THEN
    RAISE EXCEPTION 'The supplier product match is not verified'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_product
  FROM public.material_supplier_products
  WHERE id = p_expected_product_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_product.active OR v_invoice.supplier_id IS DISTINCT FROM v_product.supplier_id THEN
    RAISE EXCEPTION 'The supplier product is not an active product for this supplier'
      USING ERRCODE = '23514';
  END IF;

  v_invoice_sku := lower(btrim(COALESCE(v_line.raw_supplier_sku, '')));
  v_product_sku := lower(btrim(COALESCE(v_product.supplier_sku, '')));
  v_description := lower(btrim(regexp_replace(COALESCE(v_line.raw_description, ''), '\s+', ' ', 'g')));

  IF v_line.match_method = 'mapping' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.supplier_product_description_mappings
      WHERE supplier_id = v_invoice.supplier_id
        AND material_supplier_product_id = v_product.id
        AND normalized_description = v_description
    ) THEN
      RAISE EXCEPTION 'The saved product mapping does not match this line'
        USING ERRCODE = '23514';
    END IF;

    IF v_product_sku <> '' AND v_invoice_sku <> '' AND v_product_sku <> v_invoice_sku THEN
      RAISE EXCEPTION 'The invoice SKU conflicts with the supplier product'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF v_product_sku = '' OR v_invoice_sku = '' OR v_product_sku <> v_invoice_sku THEN
      RAISE EXCEPTION 'A matching catalogue SKU is required before an automatic price decision'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*)
    INTO v_sku_count
    FROM public.material_supplier_products
    WHERE supplier_id = v_product.supplier_id
      AND active
      AND lower(btrim(COALESCE(supplier_sku, ''))) = v_product_sku;

    IF v_sku_count <> 1 THEN
      RAISE EXCEPTION 'The supplier SKU does not identify one product'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*)
    INTO v_description_count
    FROM public.material_supplier_products
    WHERE supplier_id = v_product.supplier_id
      AND active
      AND lower(btrim(regexp_replace(COALESCE(supplier_description, ''), '\s+', ' ', 'g'))) = v_description;

    IF v_description_count <> 1 THEN
      RAISE EXCEPTION 'The invoice description matches more than one supplier product'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT purchase_unit
  INTO v_material_unit
  FROM public.materials
  WHERE id = v_product.material_id;

  v_unit := CASE lower(btrim(COALESCE(v_line.reviewed_unit, v_line.raw_unit, '')))
    WHEN 'sheet' THEN 'sheet'
    WHEN 'sheets' THEN 'sheet'
    WHEN 'roll' THEN 'roll'
    WHEN 'rolls' THEN 'roll'
    WHEN 'm' THEN 'linear_metre'
    WHEN 'metre' THEN 'linear_metre'
    WHEN 'metres' THEN 'linear_metre'
    WHEN 'meter' THEN 'linear_metre'
    WHEN 'meters' THEN 'linear_metre'
    WHEN 'linear metre' THEN 'linear_metre'
    WHEN 'linear metres' THEN 'linear_metre'
    WHEN 'linear_metre' THEN 'linear_metre'
    WHEN 'square metre' THEN 'square_metre'
    WHEN 'square metres' THEN 'square_metre'
    WHEN 'square_metre' THEN 'square_metre'
    WHEN 'each' THEN 'unit'
    WHEN 'unit' THEN 'unit'
    WHEN 'units' THEN 'unit'
    WHEN 'pack' THEN 'pack'
    WHEN 'packs' THEN 'pack'
    WHEN 'box' THEN 'pack'
    WHEN 'boxes' THEN 'pack'
    ELSE NULL
  END;

  IF v_unit IS NULL OR v_unit IS DISTINCT FROM v_material_unit THEN
    RAISE EXCEPTION 'The invoice unit does not match the material purchase unit'
      USING ERRCODE = '23514';
  END IF;

  v_invoice_price := round(COALESCE(v_line.reviewed_unit_price, v_line.raw_unit_price), 2);

  IF v_invoice_price IS NULL
    OR v_invoice_price <= 0
    OR round(p_expected_invoice_price, 2) IS DISTINCT FROM v_invoice_price
  THEN
    RAISE EXCEPTION 'The invoice price changed. Reload this invoice before deciding.'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.material_prices
  WHERE material_supplier_product_id = v_product.id
  FOR UPDATE;

  SELECT max(effective_date)
  INTO v_latest_date
  FROM public.material_prices
  WHERE material_supplier_product_id = v_product.id;

  SELECT count(*)
  INTO v_latest_count
  FROM public.material_prices
  WHERE material_supplier_product_id = v_product.id
    AND effective_date = v_latest_date;

  IF v_latest_date IS NULL OR v_latest_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'The current approved price is missing or shares its effective date'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_current
  FROM public.material_prices
  WHERE material_supplier_product_id = v_product.id
    AND effective_date = v_latest_date;

  IF v_current.id IS DISTINCT FROM p_expected_price_id
    OR v_current.price_unit IS DISTINCT FROM v_material_unit
  THEN
    RAISE EXCEPTION 'The current approved price changed. Reload this invoice before deciding.'
      USING ERRCODE = '40001';
  END IF;

  IF v_invoice.invoice_date >= v_current.effective_date THEN
    RAISE EXCEPTION 'Only an older invoice can retain the current price automatically'
      USING ERRCODE = '23514';
  END IF;

  IF round(v_current.price, 2) = v_invoice_price THEN
    RAISE EXCEPTION 'The invoice price matches the current approved price. Reload this invoice.'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.supplier_invoice_lines
  SET
    review_status = 'processed',
    internal_note = v_reason
  WHERE id = v_line.id;

  INSERT INTO public.supplier_invoice_events (
    invoice_id, invoice_line_id, actor_id, action, metadata
  )
  VALUES (
    v_invoice.id,
    v_line.id,
    p_actor_id,
    'price_change_rejected',
    jsonb_build_object(
      'rule', 'historical_price',
      'automatic', true,
      'reason', v_reason,
      'supplierId', v_invoice.supplier_id,
      'productId', v_product.id,
      'invoicePrice', v_invoice_price,
      'currentPrice', round(v_current.price, 2),
      'currentPriceId', v_current.id,
      'currentEffectiveDate', v_current.effective_date,
      'invoiceDate', v_invoice.invoice_date,
      'priceUnit', v_material_unit
    )
  );

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
    'alreadyResolved', false,
    'decision', 'keep',
    'rule', 'historical_price',
    'priceId', v_current.id,
    'productId', v_product.id,
    'materialId', v_product.material_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.retain_historical_invoice_price(
  uuid, uuid, uuid, numeric, uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.retain_historical_invoice_price(
  uuid, uuid, uuid, numeric, uuid
) TO authenticated, service_role;

COMMIT;
