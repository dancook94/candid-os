-- Confirm a supplier product that is already linked to an unresolved invoice line.
-- This upgrades the match to a manual high-confidence decision. It does not create
-- a material, a supplier product, a price, a historical price, or a future description rule.
-- Dimension and SKU checks live in the database so a direct call cannot bypass them.

CREATE OR REPLACE FUNCTION public.invoice_existing_link_dimension_conflict(
  p_description text,
  p_sku text,
  p_product_sku text,
  p_width_mm numeric,
  p_height_mm numeric,
  p_length_mm numeric,
  p_thickness_mm numeric
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_match text[];
  v_sheet_keys text[] := ARRAY[]::text[];
  v_sheet_key text;
  v_sheet_a numeric;
  v_sheet_b numeric;
  v_roll_keys text[] := ARRAY[]::text[];
  v_roll_key text;
  v_roll_width numeric;
  v_roll_length numeric;
  v_first_roll_width numeric;
  v_sheet_count integer := 0;
  v_roll_count integer := 0;
  v_slit_seen boolean := false;
  v_slit_conflict boolean := false;
  v_thickness_source text;
  v_left_a numeric;
  v_left_b numeric;
  v_right_a numeric;
  v_right_b numeric;
BEGIN
  IF NULLIF(btrim(COALESCE(p_sku, '')), '') IS NOT NULL
    AND NULLIF(btrim(COALESCE(p_product_sku, '')), '') IS NOT NULL
    AND lower(btrim(p_sku)) IS DISTINCT FROM lower(btrim(p_product_sku))
  THEN
    RETURN 'The invoice SKU does not match the supplier product.';
  END IF;

  IF p_width_mm IS NOT NULL THEN
    FOR v_match IN
      SELECT regexp_matches(COALESCE(p_description, ''), '\mslit to\s+(\d{3,4}(?:\.\d+)?)\s*mm\M', 'gi')
    LOOP
      v_slit_seen := true;
      IF round(v_match[1]::numeric) IS DISTINCT FROM round(p_width_mm) THEN
        v_slit_conflict := true;
      END IF;
    END LOOP;

    IF v_slit_seen AND v_slit_conflict THEN
      RETURN 'The invoice width does not match the catalogue product.';
    END IF;
  END IF;

  FOR v_match IN
    SELECT regexp_matches(
      COALESCE(p_description, ''),
      '((\d+(?:\.\d+)?)\s*mm\s*[x×]\s*(\d+(?:\.\d+)?)\s*m\y)|((\d+(?:\.\d+)?)\s*m\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm\y)',
      'gi'
    )
  LOOP
    IF v_match[2] IS NOT NULL THEN
      v_roll_width := v_match[2]::numeric;
      v_roll_length := v_match[3]::numeric * 1000;
    ELSE
      v_roll_width := v_match[6]::numeric;
      v_roll_length := v_match[5]::numeric * 1000;
    END IF;

    IF v_roll_width > 0 AND v_roll_length > 0 THEN
      v_roll_key := round(v_roll_width)::text || ':' || round(v_roll_length)::text;
      IF NOT v_roll_key = ANY (v_roll_keys) THEN
        v_roll_keys := array_append(v_roll_keys, v_roll_key);
        v_roll_count := v_roll_count + 1;
        IF v_first_roll_width IS NULL THEN
          v_first_roll_width := v_roll_width;
        END IF;
        IF v_roll_count = 1 THEN
          v_sheet_a := v_roll_width;
          v_sheet_b := v_roll_length;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF NOT v_slit_seen AND p_width_mm IS NOT NULL AND v_first_roll_width IS NOT NULL
    AND round(v_first_roll_width) IS DISTINCT FROM round(p_width_mm)
  THEN
    RETURN 'The invoice width does not match the catalogue product.';
  END IF;

  v_roll_width := CASE WHEN v_roll_count = 1 THEN v_sheet_a ELSE NULL END;
  v_roll_length := CASE WHEN v_roll_count = 1 THEN v_sheet_b ELSE NULL END;
  v_sheet_a := NULL;
  v_sheet_b := NULL;
  v_sheet_count := 0;

  FOR v_match IN
    SELECT regexp_matches(
      COALESCE(p_description, ''),
      '((\d{3,4}(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d{3,4}(?:\.\d+)?)\s*(?:mm)?)',
      'gi'
    )
  LOOP
    IF v_match[1] !~* 'mm' OR v_match[2]::numeric <= 0 OR v_match[3]::numeric <= 0 THEN
      CONTINUE;
    END IF;

    v_sheet_key := round(v_match[2]::numeric)::text || ':' || round(v_match[3]::numeric)::text;
    IF NOT v_sheet_key = ANY (v_sheet_keys) THEN
      v_sheet_keys := array_append(v_sheet_keys, v_sheet_key);
      v_sheet_count := v_sheet_count + 1;
      IF v_sheet_count = 1 THEN
        v_sheet_a := v_match[2]::numeric;
        v_sheet_b := v_match[3]::numeric;
      END IF;
    END IF;
  END LOOP;

  IF v_sheet_count = 1 AND v_roll_count = 1 THEN
    RETURN 'More than one size was read from the invoice line.';
  END IF;

  IF v_sheet_count = 1 THEN
    IF p_width_mm IS NULL OR p_height_mm IS NULL THEN
      RETURN 'The invoice sheet size does not match the catalogue product.';
    END IF;

    IF round(v_sheet_a) <= round(v_sheet_b) THEN
      v_left_a := round(v_sheet_a);
      v_left_b := round(v_sheet_b);
    ELSE
      v_left_a := round(v_sheet_b);
      v_left_b := round(v_sheet_a);
    END IF;

    IF round(p_width_mm) <= round(p_height_mm) THEN
      v_right_a := round(p_width_mm);
      v_right_b := round(p_height_mm);
    ELSE
      v_right_a := round(p_height_mm);
      v_right_b := round(p_width_mm);
    END IF;

    IF v_left_a IS DISTINCT FROM v_right_a OR v_left_b IS DISTINCT FROM v_right_b THEN
      RETURN 'The invoice sheet size does not match the catalogue product.';
    END IF;
  ELSIF v_roll_count = 1 THEN
    IF p_width_mm IS NULL
      OR p_length_mm IS NULL
      OR round(v_roll_width) IS DISTINCT FROM round(p_width_mm)
      OR abs(v_roll_length - p_length_mm) > 1
    THEN
      RETURN 'The invoice roll size does not match the catalogue product.';
    END IF;
  ELSIF p_width_mm IS NOT NULL OR p_height_mm IS NOT NULL OR p_length_mm IS NOT NULL THEN
    RETURN 'The invoice size could not be checked against the catalogue product.';
  END IF;

  IF p_thickness_mm IS NOT NULL THEN
    v_thickness_source := regexp_replace(
      COALESCE(p_description, ''),
      '(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm)?',
      ' ',
      'gi'
    );
    v_match := regexp_match(v_thickness_source, '(\d+(?:\.\d+)?)\s*mm', 'i');

    IF v_match IS NULL
      OR v_match[1]::numeric <= 0
      OR v_match[1]::numeric > 100
      OR abs(v_match[1]::numeric - p_thickness_mm) >= 0.15
    THEN
      RETURN 'The invoice thickness does not match the catalogue product.';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_existing_bulk_invoice_links(
  p_line_ids uuid[],
  p_product_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_line public.supplier_invoice_lines%ROWTYPE;
  v_invoice public.supplier_invoices%ROWTYPE;
  v_product public.material_supplier_products%ROWTYPE;
  v_material public.materials%ROWTYPE;
  v_material_unit text;
  v_current public.material_prices%ROWTYPE;
  v_dimension_conflict text;
  v_invoice_price numeric;
  v_status text;
  v_invoice_id uuid;
  v_updated integer := 0;
  v_decision uuid := gen_random_uuid();
BEGIN
  IF NOT public.is_approved_candid_admin() OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Not allowed to confirm an invoice product' USING ERRCODE = '42501';
  END IF;

  p_line_ids := ARRAY(SELECT DISTINCT id FROM unnest(p_line_ids) AS id ORDER BY id);

  IF cardinality(p_line_ids) = 0 OR cardinality(p_line_ids) > 200 THEN
    RAISE EXCEPTION 'Select the invoice lines to confirm' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_product
  FROM public.material_supplier_products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_product.active THEN
    RAISE EXCEPTION 'The catalogue product is not active' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_material
  FROM public.materials
  WHERE id = v_product.material_id
  FOR UPDATE;

  v_material_unit := v_material.purchase_unit;

  PERFORM 1
  FROM public.material_prices
  WHERE material_supplier_product_id = v_product.id
  FOR UPDATE;

  SELECT * INTO v_current
  FROM public.material_prices
  WHERE material_supplier_product_id = v_product.id
  ORDER BY effective_date DESC, approved_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  PERFORM 1 FROM (
    SELECT id FROM public.supplier_invoice_lines
    WHERE id = ANY (p_line_ids)
    ORDER BY id
    FOR UPDATE
  ) locked;

  IF (SELECT count(*) FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)) <> cardinality(p_line_ids) THEN
    RAISE EXCEPTION 'Invoice line not found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN
    SELECT * FROM public.supplier_invoice_lines
    WHERE id = ANY (p_line_ids)
    ORDER BY id
  LOOP
    SELECT * INTO v_invoice FROM public.supplier_invoices WHERE id = v_line.invoice_id FOR UPDATE;

    v_invoice_price := round(COALESCE(v_line.reviewed_unit_price, v_line.raw_unit_price), 2);
    v_status := CASE
      WHEN v_invoice_price IS NULL OR v_current.id IS NULL OR v_current.price_unit IS DISTINCT FROM v_material_unit THEN 'needs_review'
      WHEN round(v_current.price, 2) = v_invoice_price THEN 'processed'
      ELSE 'price_change'
    END;

    IF v_line.matched_supplier_product_id = p_product_id
      AND v_line.match_confidence = 'high'
      AND v_line.match_method = 'manual'
      AND v_line.review_status = v_status
    THEN
      CONTINUE;
    END IF;

    IF v_line.matched_supplier_product_id IS DISTINCT FROM p_product_id THEN
      RAISE EXCEPTION 'Confirm the supplier product already linked to this line' USING ERRCODE = '23514';
    END IF;

    IF v_invoice.supplier_id IS DISTINCT FROM v_product.supplier_id THEN
      RAISE EXCEPTION 'The linked product belongs to a different supplier' USING ERRCODE = '23514';
    END IF;

    IF public.normalise_invoice_purchase_unit(COALESCE(v_line.reviewed_unit, v_line.raw_unit)) IS DISTINCT FROM v_material_unit THEN
      RAISE EXCEPTION 'The invoice unit does not match the material purchase unit' USING ERRCODE = '23514';
    END IF;

    v_dimension_conflict := public.invoice_existing_link_dimension_conflict(
      v_line.raw_description,
      v_line.raw_supplier_sku,
      v_product.supplier_sku,
      v_material.purchase_width_mm,
      v_material.purchase_height_mm,
      v_material.purchase_length_mm,
      v_material.thickness_mm
    );

    IF v_dimension_conflict IS NOT NULL THEN
      RAISE EXCEPTION '%', v_dimension_conflict USING ERRCODE = '23514';
    END IF;

    IF v_line.review_status IS DISTINCT FROM 'needs_review'
      OR NULLIF(btrim(COALESCE(v_line.maths_warning, '')), '') IS NOT NULL
      OR v_invoice.extraction_status IS DISTINCT FROM 'extracted'
    THEN
      RAISE EXCEPTION 'A selected line changed. Reload before applying.' USING ERRCODE = '40001';
    END IF;

    UPDATE public.supplier_invoice_lines
    SET
      match_confidence = 'high',
      match_method = 'manual',
      review_status = v_status,
      reviewed_unit = v_material_unit,
      internal_note = CASE
        WHEN v_status = 'processed' THEN 'The existing supplier-product link was confirmed. The invoice price matches the approved price.'
        WHEN v_status = 'price_change' THEN 'The existing supplier-product link was confirmed. The invoice price still needs a decision.'
        ELSE 'The existing supplier-product link was confirmed. There is no current price in this unit.'
      END
    WHERE id = v_line.id;

    INSERT INTO public.supplier_invoice_events (invoice_id, invoice_line_id, actor_id, action, metadata)
    VALUES (
      v_line.invoice_id,
      v_line.id,
      p_actor_id,
      'product_match_confirmed',
      jsonb_build_object(
        'bulk', true,
        'futureRule', false,
        'existingLink', true,
        'decisionId', v_decision,
        'productId', p_product_id,
        'lineIds', to_jsonb(p_line_ids)
      )
    );

    v_updated := v_updated + 1;
  END LOOP;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('alreadyResolved', true, 'decision', 'confirm_existing_link', 'productId', p_product_id);
  END IF;

  FOR v_invoice_id IN
    SELECT DISTINCT invoice_id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)
  LOOP
    PERFORM public.refresh_supplier_invoice_processing_status(v_invoice_id);
  END LOOP;

  RETURN jsonb_build_object(
    'alreadyResolved', false,
    'decision', 'confirm_existing_link',
    'decisionId', v_decision,
    'productId', p_product_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoice_existing_link_dimension_conflict(text, text, text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_existing_bulk_invoice_links(uuid[], uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_existing_bulk_invoice_links(uuid[], uuid, uuid) TO authenticated;
