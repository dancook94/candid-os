-- Grouped invoice review for the lines an administrator explicitly selects.
-- Apply manually to the Test project only. Do not push this from config.toml.
-- Historical retention writes supplier_invoice_historical_prices and does not insert a current price.
-- Approving a current price inserts one material_prices row.
-- Creating a material inserts one opening price and does not save a future description rule.
-- None of these functions change supplier preference or saved quote costs.

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_supplier_invoice_processing_status(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.supplier_invoices%ROWTYPE;
  v_statuses text[];
  v_processing text;
BEGIN
  IF NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Not allowed to refresh an invoice' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invoice
  FROM public.supplier_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT array_agg(review_status)
  INTO v_statuses
  FROM public.supplier_invoice_lines
  WHERE invoice_id = p_invoice_id;

  v_processing := CASE
    WHEN v_invoice.extraction_status <> 'extracted' OR v_statuses IS NULL THEN 'extraction_error'
    WHEN 'extraction_error' = ANY (v_statuses) THEN 'extraction_error'
    WHEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(v_invoice.extraction_warnings, '[]'::jsonb)) AS warning
      WHERE warning LIKE '%Subtotal%' OR warning LIKE '%line totals%'
    ) THEN 'extraction_error'
    WHEN 'unmatched' = ANY (v_statuses) THEN 'unmatched'
    WHEN 'needs_review' = ANY (v_statuses) OR 'query' = ANY (v_statuses) THEN 'needs_review'
    WHEN 'price_change' = ANY (v_statuses) THEN 'price_change'
    WHEN NOT EXISTS (
      SELECT 1 FROM unnest(v_statuses) AS status WHERE status <> 'ignored'
    ) THEN 'ignored'
    ELSE 'processed'
  END;

  UPDATE public.supplier_invoices
  SET processing_status = v_processing
  WHERE id = p_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_supplier_invoice_processing_status(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.normalise_invoice_purchase_unit(p_unit text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE lower(btrim(COALESCE(p_unit, '')))
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
    WHEN 'litre' THEN 'litre'
    WHEN 'litres' THEN 'litre'
    WHEN 'liter' THEN 'litre'
    WHEN 'liters' THEN 'litre'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.normalise_invoice_purchase_unit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalise_invoice_purchase_unit(text) TO authenticated;

ALTER TABLE public.materials DROP CONSTRAINT materials_purchase_unit_check;
ALTER TABLE public.materials ADD CONSTRAINT materials_purchase_unit_check CHECK (
  purchase_unit IN ('sheet', 'roll', 'linear_metre', 'square_metre', 'unit', 'pack', 'litre')
);

ALTER TABLE public.material_prices DROP CONSTRAINT material_prices_price_unit_check;
ALTER TABLE public.material_prices ADD CONSTRAINT material_prices_price_unit_check CHECK (
  price_unit IN ('sheet', 'roll', 'linear_metre', 'square_metre', 'unit', 'pack', 'litre')
);

CREATE TABLE public.supplier_invoice_historical_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_line_id uuid NOT NULL UNIQUE REFERENCES public.supplier_invoice_lines (id),
  invoice_id uuid NOT NULL REFERENCES public.supplier_invoices (id),
  material_supplier_product_id uuid NOT NULL REFERENCES public.material_supplier_products (id),
  invoice_price numeric(12, 2) NOT NULL CHECK (invoice_price > 0),
  price_unit text NOT NULL CHECK (
    price_unit IN ('sheet', 'roll', 'linear_metre', 'square_metre', 'unit', 'pack', 'litre')
  ),
  invoice_date date NOT NULL,
  invoice_line_total numeric(12, 2),
  retained_current_price_id uuid NOT NULL REFERENCES public.material_prices (id),
  retained_current_price numeric(12, 2) NOT NULL CHECK (retained_current_price > 0),
  decision_id uuid NOT NULL,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_invoice_historical_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_invoice_historical_prices_admin_select
  ON public.supplier_invoice_historical_prices
  FOR SELECT
  TO authenticated
  USING (public.is_approved_candid_admin());

REVOKE ALL ON TABLE public.supplier_invoice_historical_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.supplier_invoice_historical_prices TO authenticated;

CREATE OR REPLACE FUNCTION public.ignore_bulk_invoice_charges(
  p_line_ids uuid[],
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_line public.supplier_invoice_lines%ROWTYPE;
  v_invoice_id uuid;
  v_decision uuid := gen_random_uuid();
BEGIN
  IF NOT public.is_approved_candid_admin() OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Not allowed to ignore invoice charges' USING ERRCODE = '42501';
  END IF;

  p_line_ids := ARRAY(SELECT DISTINCT id FROM unnest(p_line_ids) AS id ORDER BY id);

  IF cardinality(p_line_ids) = 0 OR cardinality(p_line_ids) > 200 THEN
    RAISE EXCEPTION 'Select the invoice lines to ignore' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM (
    SELECT id FROM public.supplier_invoice_lines
    WHERE id = ANY (p_line_ids)
    ORDER BY id
    FOR UPDATE
  ) locked;

  IF (SELECT count(*) FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)) <> cardinality(p_line_ids) THEN
    RAISE EXCEPTION 'Invoice line not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_invoice_lines
    WHERE id = ANY (p_line_ids) AND review_status IS DISTINCT FROM 'ignored'
  ) THEN
    RETURN jsonb_build_object('alreadyResolved', true, 'decision', 'ignore_charges');
  END IF;

  FOR v_line IN
    SELECT * FROM public.supplier_invoice_lines
    WHERE id = ANY (p_line_ids)
    ORDER BY id
  LOOP
    IF v_line.review_status = 'ignored' THEN
      CONTINUE;
    END IF;

    IF v_line.review_status NOT IN ('unmatched', 'needs_review')
      OR NULLIF(btrim(COALESCE(v_line.maths_warning, '')), '') IS NOT NULL
    THEN
      RAISE EXCEPTION 'A selected line changed. Reload before applying.' USING ERRCODE = '40001';
    END IF;

    IF v_line.raw_description ~* '(fabric|hips|vinyl|ink|paper|banner|dibond|foam|acrylic|slit to|\d{3,4}\s*mm)'
      OR v_line.raw_description !~* '(carriage|shipping|freight|postage|couriers?|delivery|overnight|next day|packaging|package to send|small order)'
    THEN
      RAISE EXCEPTION 'This line is not a non-material charge' USING ERRCODE = '23514';
    END IF;

    UPDATE public.supplier_invoice_lines
    SET
      review_status = 'ignored',
      matched_supplier_product_id = NULL,
      match_confidence = NULL,
      match_method = NULL,
      internal_note = 'Confirmed as a non-material charge. The original invoice line is unchanged.'
    WHERE id = v_line.id;

    INSERT INTO public.supplier_invoice_events (invoice_id, invoice_line_id, actor_id, action, metadata)
    VALUES (
      v_line.invoice_id,
      v_line.id,
      p_actor_id,
      'line_ignored',
      jsonb_build_object('bulk', true, 'futureRule', false, 'decisionId', v_decision, 'lineIds', to_jsonb(p_line_ids))
    );
  END LOOP;

  FOR v_invoice_id IN
    SELECT DISTINCT invoice_id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)
  LOOP
    PERFORM public.refresh_supplier_invoice_processing_status(v_invoice_id);
  END LOOP;

  RETURN jsonb_build_object('alreadyResolved', false, 'decision', 'ignore_charges', 'decisionId', v_decision);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_bulk_invoice_products(
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
  v_material_unit text;
  v_current public.material_prices%ROWTYPE;
  v_invoice_price numeric;
  v_status text;
  v_invoice_id uuid;
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

  SELECT purchase_unit INTO v_material_unit
  FROM public.materials
  WHERE id = v_product.material_id;

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

  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_invoice_lines
    WHERE id = ANY (p_line_ids)
      AND matched_supplier_product_id IS DISTINCT FROM p_product_id
  ) THEN
    RETURN jsonb_build_object('alreadyResolved', true, 'decision', 'confirm_product', 'productId', p_product_id);
  END IF;

  FOR v_line IN
    SELECT * FROM public.supplier_invoice_lines
    WHERE id = ANY (p_line_ids)
    ORDER BY id
  LOOP
    IF v_line.matched_supplier_product_id = p_product_id THEN
      CONTINUE;
    END IF;

    IF v_line.matched_supplier_product_id IS NOT NULL
      OR v_line.review_status NOT IN ('unmatched', 'needs_review')
      OR NULLIF(btrim(COALESCE(v_line.maths_warning, '')), '') IS NOT NULL
    THEN
      RAISE EXCEPTION 'A selected line changed. Reload before applying.' USING ERRCODE = '40001';
    END IF;

    SELECT * INTO v_invoice FROM public.supplier_invoices WHERE id = v_line.invoice_id FOR UPDATE;

    IF v_invoice.supplier_id IS DISTINCT FROM v_product.supplier_id
      OR v_invoice.extraction_status IS DISTINCT FROM 'extracted'
    THEN
      RAISE EXCEPTION 'The product does not belong to this invoice supplier' USING ERRCODE = '23514';
    END IF;

    IF public.normalise_invoice_purchase_unit(COALESCE(v_line.reviewed_unit, v_line.raw_unit)) IS DISTINCT FROM v_material_unit THEN
      RAISE EXCEPTION 'The invoice unit does not match the material purchase unit' USING ERRCODE = '23514';
    END IF;

    v_invoice_price := round(COALESCE(v_line.reviewed_unit_price, v_line.raw_unit_price), 2);
    v_status := CASE
      WHEN v_current.id IS NULL THEN 'needs_review'
      WHEN round(v_current.price, 2) = v_invoice_price AND v_current.price_unit = v_material_unit THEN 'processed'
      ELSE 'price_change'
    END;

    UPDATE public.supplier_invoice_lines
    SET
      matched_supplier_product_id = p_product_id,
      match_confidence = 'high',
      match_method = 'manual',
      review_status = v_status,
      reviewed_unit = v_material_unit,
      internal_note = CASE
        WHEN v_status = 'processed' THEN 'Matched to the existing supplier product.'
        WHEN v_status = 'price_change' THEN 'Matched to the existing supplier product. The invoice price still needs a decision.'
        ELSE 'Matched to the existing supplier product. There is no current price in this unit.'
      END
    WHERE id = v_line.id;

    INSERT INTO public.supplier_invoice_events (invoice_id, invoice_line_id, actor_id, action, metadata)
    VALUES (
      v_line.invoice_id,
      v_line.id,
      p_actor_id,
      'product_match_confirmed',
      jsonb_build_object('bulk', true, 'futureRule', false, 'decisionId', v_decision, 'productId', p_product_id, 'lineIds', to_jsonb(p_line_ids))
    );
  END LOOP;

  FOR v_invoice_id IN
    SELECT DISTINCT invoice_id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)
  LOOP
    PERFORM public.refresh_supplier_invoice_processing_status(v_invoice_id);
  END LOOP;

  RETURN jsonb_build_object('alreadyResolved', false, 'decision', 'confirm_product', 'decisionId', v_decision, 'productId', p_product_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.retain_bulk_historical_invoice_prices(
  p_line_ids uuid[],
  p_expected_product_id uuid,
  p_expected_price_id uuid,
  p_expected_invoice_price numeric,
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
  v_material_unit text;
  v_current public.material_prices%ROWTYPE;
  v_invoice_price numeric;
  v_invoice_id uuid;
  v_decision uuid := gen_random_uuid();
BEGIN
  IF NOT public.is_approved_candid_admin() OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Not allowed to retain an invoice price' USING ERRCODE = '42501';
  END IF;

  p_line_ids := ARRAY(SELECT DISTINCT id FROM unnest(p_line_ids) AS id ORDER BY id);

  IF cardinality(p_line_ids) = 0 OR cardinality(p_line_ids) > 200 THEN
    RAISE EXCEPTION 'Select the invoice lines to retain' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_product
  FROM public.material_supplier_products
  WHERE id = p_expected_product_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_product.active THEN
    RAISE EXCEPTION 'The catalogue product is not active' USING ERRCODE = '23514';
  END IF;

  SELECT purchase_unit INTO v_material_unit FROM public.materials WHERE id = v_product.material_id;

  PERFORM 1 FROM public.material_prices WHERE material_supplier_product_id = v_product.id FOR UPDATE;

  SELECT * INTO v_current
  FROM public.material_prices
  WHERE material_supplier_product_id = v_product.id
  ORDER BY effective_date DESC, approved_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF v_current.id IS DISTINCT FROM p_expected_price_id OR v_current.price_unit IS DISTINCT FROM v_material_unit THEN
    RAISE EXCEPTION 'The current approved price changed. Reload before applying.' USING ERRCODE = '40001';
  END IF;

  PERFORM 1 FROM (
    SELECT id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids) ORDER BY id FOR UPDATE
  ) locked;

  IF (SELECT count(*) FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)) <> cardinality(p_line_ids) THEN
    RAISE EXCEPTION 'Invoice line not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.supplier_invoice_lines AS line
    WHERE line.id = ANY (p_line_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.supplier_invoice_events AS event
        WHERE event.invoice_line_id = line.id
          AND event.action = 'price_change_rejected'
          AND event.metadata->>'rule' = 'historical_price'
      )
  ) THEN
    RETURN jsonb_build_object('alreadyResolved', true, 'decision', 'keep', 'rule', 'historical_price');
  END IF;

  FOR v_line IN
    SELECT * FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids) ORDER BY id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.supplier_invoice_events
      WHERE invoice_line_id = v_line.id
        AND action = 'price_change_rejected'
        AND metadata->>'rule' = 'historical_price'
    ) OR EXISTS (
      SELECT 1 FROM public.supplier_invoice_historical_prices
      WHERE invoice_line_id = v_line.id
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_invoice FROM public.supplier_invoices WHERE id = v_line.invoice_id FOR UPDATE;
    v_invoice_price := round(COALESCE(v_line.reviewed_unit_price, v_line.raw_unit_price), 2);

    IF v_line.review_status IS DISTINCT FROM 'price_change'
      OR v_line.matched_supplier_product_id IS DISTINCT FROM p_expected_product_id
      OR v_line.match_confidence IS DISTINCT FROM 'high'
      OR NULLIF(btrim(COALESCE(v_line.maths_warning, '')), '') IS NOT NULL
      OR v_invoice.extraction_status IS DISTINCT FROM 'extracted'
      OR v_invoice.supplier_id IS DISTINCT FROM v_product.supplier_id
      OR v_invoice.invoice_date IS NULL
      OR v_invoice.invoice_date >= v_current.effective_date
      OR public.normalise_invoice_purchase_unit(COALESCE(v_line.reviewed_unit, v_line.raw_unit)) IS DISTINCT FROM v_material_unit
      OR v_invoice_price IS DISTINCT FROM round(p_expected_invoice_price, 2)
      OR round(v_current.price, 2) = v_invoice_price
    THEN
      RAISE EXCEPTION 'A selected line changed. Reload before applying.' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.supplier_invoice_historical_prices (
      invoice_line_id,
      invoice_id,
      material_supplier_product_id,
      invoice_price,
      price_unit,
      invoice_date,
      invoice_line_total,
      retained_current_price_id,
      retained_current_price,
      decision_id,
      recorded_by
    )
    VALUES (
      v_line.id,
      v_invoice.id,
      v_product.id,
      v_invoice_price,
      v_material_unit,
      v_invoice.invoice_date,
      round(v_line.raw_line_total, 2),
      v_current.id,
      round(v_current.price, 2),
      v_decision,
      p_actor_id
    );

    UPDATE public.supplier_invoice_lines
    SET
      review_status = 'processed',
      internal_note = 'Historical invoice price recorded. The current approved price was not changed.'
    WHERE id = v_line.id;

    INSERT INTO public.supplier_invoice_events (invoice_id, invoice_line_id, actor_id, action, metadata)
    VALUES (
      v_invoice.id,
      v_line.id,
      p_actor_id,
      'price_change_rejected',
      jsonb_build_object(
        'rule', 'historical_price',
        'bulk', true,
        'automatic', false,
        'futureRule', false,
        'decisionId', v_decision,
        'productId', v_product.id,
        'invoicePrice', v_invoice_price,
        'currentPriceId', v_current.id,
        'currentPrice', round(v_current.price, 2),
        'lineIds', to_jsonb(p_line_ids)
      )
    );
  END LOOP;

  FOR v_invoice_id IN
    SELECT DISTINCT invoice_id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)
  LOOP
    PERFORM public.refresh_supplier_invoice_processing_status(v_invoice_id);
  END LOOP;

  RETURN jsonb_build_object('alreadyResolved', false, 'decision', 'keep', 'rule', 'historical_price', 'decisionId', v_decision);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_bulk_invoice_price(
  p_line_ids uuid[],
  p_expected_product_id uuid,
  p_expected_price_id uuid,
  p_expected_invoice_price numeric,
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
  v_material_unit text;
  v_current public.material_prices%ROWTYPE;
  v_reference text;
  v_price_id uuid;
  v_invoice_id uuid;
  v_decision uuid := gen_random_uuid();
BEGIN
  IF NOT public.is_approved_candid_admin() OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Not allowed to approve an invoice price' USING ERRCODE = '42501';
  END IF;

  p_line_ids := ARRAY(SELECT DISTINCT id FROM unnest(p_line_ids) AS id ORDER BY id);
  v_reference := 'bulk:' || md5(array_to_string(p_line_ids::text[], ','));

  IF cardinality(p_line_ids) = 0 OR cardinality(p_line_ids) > 200 THEN
    RAISE EXCEPTION 'Select the invoice lines to approve' USING ERRCODE = '23514';
  END IF;

  IF round(p_expected_invoice_price, 2) IS NULL OR round(p_expected_invoice_price, 2) <= 0 THEN
    RAISE EXCEPTION 'The invoice price must be greater than zero' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_product FROM public.material_supplier_products WHERE id = p_expected_product_id FOR UPDATE;

  IF NOT FOUND OR NOT v_product.active THEN
    RAISE EXCEPTION 'The catalogue product is not active' USING ERRCODE = '23514';
  END IF;

  SELECT purchase_unit INTO v_material_unit FROM public.materials WHERE id = v_product.material_id;

  PERFORM 1 FROM (
    SELECT id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids) ORDER BY id FOR UPDATE
  ) locked;

  PERFORM 1 FROM public.material_prices WHERE material_supplier_product_id = v_product.id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.material_prices
    WHERE source_type = 'supplier_invoice' AND source_reference = v_reference
  ) AND NOT EXISTS (
    SELECT 1 FROM public.supplier_invoice_lines
    WHERE id = ANY (p_line_ids) AND review_status IS DISTINCT FROM 'processed'
  ) THEN
    RETURN jsonb_build_object('alreadyResolved', true, 'decision', 'approve', 'priceCount', 1);
  END IF;

  SELECT * INTO v_current
  FROM public.material_prices
  WHERE material_supplier_product_id = v_product.id
  ORDER BY effective_date DESC, approved_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF v_current.id IS DISTINCT FROM p_expected_price_id THEN
    RAISE EXCEPTION 'The current approved price changed. Reload before applying.' USING ERRCODE = '40001';
  END IF;

  FOR v_line IN SELECT * FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids) ORDER BY id
  LOOP
    SELECT * INTO v_invoice FROM public.supplier_invoices WHERE id = v_line.invoice_id FOR UPDATE;

    IF v_line.review_status IS DISTINCT FROM 'price_change'
      OR v_line.matched_supplier_product_id IS DISTINCT FROM p_expected_product_id
      OR v_line.match_confidence IS DISTINCT FROM 'high'
      OR NULLIF(btrim(COALESCE(v_line.maths_warning, '')), '') IS NOT NULL
      OR v_invoice.supplier_id IS DISTINCT FROM v_product.supplier_id
      OR v_invoice.extraction_status IS DISTINCT FROM 'extracted'
      OR public.normalise_invoice_purchase_unit(COALESCE(v_line.reviewed_unit, v_line.raw_unit)) IS DISTINCT FROM v_material_unit
      OR round(COALESCE(v_line.reviewed_unit_price, v_line.raw_unit_price), 2) IS DISTINCT FROM round(p_expected_invoice_price, 2)
    THEN
      RAISE EXCEPTION 'A selected line changed. Reload before applying.' USING ERRCODE = '40001';
    END IF;
  END LOOP;

  INSERT INTO public.material_prices (
    material_supplier_product_id, price, currency, price_unit, effective_date, approved_by, source_type, source_reference
  )
  VALUES (
    v_product.id,
    round(p_expected_invoice_price, 2),
    'GBP',
    v_material_unit,
    current_date,
    p_actor_id,
    'supplier_invoice',
    v_reference
  )
  RETURNING id INTO v_price_id;

  UPDATE public.supplier_invoice_lines
  SET
    review_status = 'processed',
    internal_note = 'The invoice price was explicitly approved as the new current supplier price.'
  WHERE id = ANY (p_line_ids);

  INSERT INTO public.supplier_invoice_events (invoice_id, invoice_line_id, actor_id, action, metadata)
  SELECT
    line.invoice_id,
    line.id,
    p_actor_id,
    'price_change_approved',
    jsonb_build_object(
      'bulk', true,
      'futureRule', false,
      'decisionId', v_decision,
      'productId', v_product.id,
      'priceId', v_price_id,
      'priceCount', 1,
      'invoicePrice', round(p_expected_invoice_price, 2),
      'previousPriceId', v_current.id,
      'lineIds', to_jsonb(p_line_ids)
    )
  FROM public.supplier_invoice_lines AS line
  WHERE line.id = ANY (p_line_ids);

  FOR v_invoice_id IN
    SELECT DISTINCT invoice_id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)
  LOOP
    PERFORM public.refresh_supplier_invoice_processing_status(v_invoice_id);
  END LOOP;

  RETURN jsonb_build_object('alreadyResolved', false, 'decision', 'approve', 'priceId', v_price_id, 'priceCount', 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_bulk_invoice_purchase_units(
  p_line_ids uuid[],
  p_unit text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_line public.supplier_invoice_lines%ROWTYPE;
  v_invoice_id uuid;
  v_decision uuid := gen_random_uuid();
BEGIN
  IF NOT public.is_approved_candid_admin() OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Not allowed to set an invoice unit' USING ERRCODE = '42501';
  END IF;

  IF p_unit NOT IN ('sheet', 'roll', 'linear_metre', 'square_metre', 'unit', 'pack', 'litre') THEN
    RAISE EXCEPTION 'Choose a purchase unit from the list' USING ERRCODE = '23514';
  END IF;

  p_line_ids := ARRAY(SELECT DISTINCT id FROM unnest(p_line_ids) AS id ORDER BY id);

  IF cardinality(p_line_ids) = 0 OR cardinality(p_line_ids) > 200 THEN
    RAISE EXCEPTION 'Select the invoice lines' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM (
    SELECT id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids) ORDER BY id FOR UPDATE
  ) locked;

  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_invoice_lines
    WHERE id = ANY (p_line_ids) AND reviewed_unit IS DISTINCT FROM p_unit
  ) THEN
    RETURN jsonb_build_object('alreadyResolved', true, 'decision', 'set_purchase_unit', 'unit', p_unit);
  END IF;

  FOR v_line IN SELECT * FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids) ORDER BY id
  LOOP
    IF v_line.reviewed_unit = p_unit THEN
      CONTINUE;
    END IF;

    IF v_line.review_status NOT IN ('unmatched', 'needs_review')
      OR NULLIF(btrim(COALESCE(v_line.maths_warning, '')), '') IS NOT NULL
    THEN
      RAISE EXCEPTION 'A selected line changed. Reload before applying.' USING ERRCODE = '40001';
    END IF;

    UPDATE public.supplier_invoice_lines
    SET
      reviewed_unit = p_unit,
      review_status = 'needs_review',
      internal_note = 'Purchase unit confirmed. The invoice price was not recalculated.'
    WHERE id = v_line.id;

    INSERT INTO public.supplier_invoice_events (invoice_id, invoice_line_id, actor_id, action, metadata)
    VALUES (
      v_line.invoice_id,
      v_line.id,
      p_actor_id,
      'line_corrected',
      jsonb_build_object('bulk', true, 'futureRule', false, 'decisionId', v_decision, 'unit', p_unit, 'lineIds', to_jsonb(p_line_ids))
    );
  END LOOP;

  FOR v_invoice_id IN
    SELECT DISTINCT invoice_id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)
  LOOP
    PERFORM public.refresh_supplier_invoice_processing_status(v_invoice_id);
  END LOOP;

  RETURN jsonb_build_object('alreadyResolved', false, 'decision', 'set_purchase_unit', 'decisionId', v_decision, 'unit', p_unit);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_bulk_material_from_invoice_lines(
  p_line_ids uuid[],
  p_actor_id uuid,
  p_name text,
  p_purchase_unit text,
  p_purchase_width_mm numeric,
  p_purchase_height_mm numeric,
  p_purchase_length_mm numeric,
  p_supplier_sku text,
  p_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_line public.supplier_invoice_lines%ROWTYPE;
  v_invoice public.supplier_invoices%ROWTYPE;
  v_supplier_id uuid;
  v_identity text;
  v_material_id uuid;
  v_product_id uuid;
  v_price_id uuid;
  v_description text;
  v_effective date;
  v_invoice_id uuid;
  v_decision uuid := gen_random_uuid();
  v_existing_product uuid;
BEGIN
  IF NOT public.is_approved_candid_admin() OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Not allowed to create a material from an invoice' USING ERRCODE = '42501';
  END IF;

  IF p_price IS NULL OR p_price <= 0 OR p_purchase_unit NOT IN ('sheet', 'roll', 'linear_metre', 'square_metre', 'unit', 'pack', 'litre') THEN
    RAISE EXCEPTION 'Enter the material, unit, and opening price' USING ERRCODE = '23514';
  END IF;

  p_line_ids := ARRAY(SELECT DISTINCT id FROM unnest(p_line_ids) AS id ORDER BY id);
  p_name := regexp_replace(btrim(p_name), '\s+', ' ', 'g');

  IF p_name = '' OR cardinality(p_line_ids) = 0 OR cardinality(p_line_ids) > 200 THEN
    RAISE EXCEPTION 'Enter the material name and select the lines' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM (
    SELECT id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids) ORDER BY id FOR UPDATE
  ) locked;

  IF (SELECT count(*) FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)) <> cardinality(p_line_ids) THEN
    RAISE EXCEPTION 'Invoice line not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT invoice.supplier_id, min(invoice.invoice_date)
  INTO v_supplier_id, v_effective
  FROM public.supplier_invoice_lines AS line
  JOIN public.supplier_invoices AS invoice ON invoice.id = line.invoice_id
  WHERE line.id = ANY (p_line_ids)
  GROUP BY invoice.supplier_id;

  IF v_supplier_id IS NULL OR v_effective IS NULL OR (
    SELECT count(DISTINCT invoice.supplier_id)
    FROM public.supplier_invoice_lines AS line
    JOIN public.supplier_invoices AS invoice ON invoice.id = line.invoice_id
    WHERE line.id = ANY (p_line_ids)
  ) <> 1 THEN
    RAISE EXCEPTION 'Choose the supplier and check the invoice dates before creating a material' USING ERRCODE = '23514';
  END IF;

  SELECT matched_supplier_product_id INTO v_existing_product
  FROM public.supplier_invoice_lines
  WHERE id = ANY (p_line_ids)
  GROUP BY matched_supplier_product_id
  HAVING count(*) = cardinality(p_line_ids);

  IF v_existing_product IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.supplier_invoice_lines
    WHERE id = ANY (p_line_ids) AND review_status NOT IN ('processed', 'price_change')
  ) THEN
    RETURN jsonb_build_object('alreadyResolved', true, 'decision', 'create_material', 'productId', v_existing_product);
  END IF;

  v_identity := public.material_identity_key(
    p_name, NULL, NULL, NULL, p_purchase_unit, p_purchase_width_mm, p_purchase_height_mm, p_purchase_length_mm
  );
  v_description := lower(p_name);

  PERFORM pg_advisory_xact_lock(hashtextextended(v_identity, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_supplier_id::text || ':' || v_description, 0));

  IF NULLIF(btrim(COALESCE(p_supplier_sku, '')), '') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_supplier_id::text || ':' || lower(btrim(p_supplier_sku)), 0)
    );
  END IF;

  IF EXISTS (SELECT 1 FROM public.materials WHERE identity_key = v_identity) THEN
    RAISE EXCEPTION 'A material with this name and specification already exists' USING ERRCODE = '23505';
  END IF;

  IF NULLIF(btrim(COALESCE(p_supplier_sku, '')), '') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.material_supplier_products
    WHERE supplier_id = v_supplier_id AND lower(supplier_sku) = lower(btrim(p_supplier_sku))
  ) THEN
    RAISE EXCEPTION 'This supplier already has that SKU' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.material_supplier_products
    WHERE supplier_id = v_supplier_id AND normalized_description = v_description
  ) THEN
    RAISE EXCEPTION 'This supplier already has that product description' USING ERRCODE = '23505';
  END IF;

  FOR v_line IN SELECT * FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids) ORDER BY id
  LOOP
    SELECT * INTO v_invoice FROM public.supplier_invoices WHERE id = v_line.invoice_id FOR UPDATE;

    IF v_line.review_status NOT IN ('unmatched', 'needs_review')
      OR NULLIF(btrim(COALESCE(v_line.maths_warning, '')), '') IS NOT NULL
      OR v_invoice.extraction_status IS DISTINCT FROM 'extracted'
      OR v_invoice.invoice_date IS NULL
      OR v_invoice.supplier_id IS DISTINCT FROM v_supplier_id
    THEN
      RAISE EXCEPTION 'A selected line changed. Reload before applying.' USING ERRCODE = '40001';
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.materials (
      name, purchase_unit, purchase_width_mm, purchase_height_mm, purchase_length_mm, identity_key, active
    )
    VALUES (p_name, p_purchase_unit, p_purchase_width_mm, p_purchase_height_mm, p_purchase_length_mm, v_identity, true)
    RETURNING id INTO v_material_id;

  INSERT INTO public.material_supplier_products (
    material_id, supplier_id, supplier_sku, supplier_description, normalized_description, is_preferred, active
  )
  VALUES (
    v_material_id,
    v_supplier_id,
    NULLIF(btrim(COALESCE(p_supplier_sku, '')), ''),
    p_name,
    v_description,
    false,
    true
  )
  RETURNING id INTO v_product_id;

  INSERT INTO public.material_prices (
    material_supplier_product_id, price, currency, price_unit, effective_date, approved_by, source_type, source_reference
  )
  VALUES (
    v_product_id,
    round(p_price, 2),
    'GBP',
    p_purchase_unit,
    v_effective,
    p_actor_id,
    'supplier_invoice',
    'bulk:' || md5(array_to_string(p_line_ids::text[], ','))
    )
    RETURNING id INTO v_price_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'A material with this name and specification already exists' USING ERRCODE = '23505';
  END;

  FOR v_line IN SELECT * FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids) ORDER BY id
  LOOP
    UPDATE public.supplier_invoice_lines
    SET
      matched_supplier_product_id = v_product_id,
      match_confidence = 'high',
      match_method = 'manual',
      reviewed_unit = p_purchase_unit,
      review_status = CASE
        WHEN round(COALESCE(reviewed_unit_price, raw_unit_price), 2) = round(p_price, 2) THEN 'processed'
        ELSE 'price_change'
      END,
      internal_note = 'Created from the selected invoice lines. The original invoice text is unchanged.'
    WHERE id = v_line.id;

    INSERT INTO public.supplier_invoice_events (invoice_id, invoice_line_id, actor_id, action, metadata)
    VALUES
      (v_line.invoice_id, v_line.id, p_actor_id, 'material_created', jsonb_build_object('bulk', true, 'futureRule', false, 'decisionId', v_decision, 'materialId', v_material_id, 'name', p_name, 'lineIds', to_jsonb(p_line_ids))),
      (v_line.invoice_id, v_line.id, p_actor_id, 'supplier_product_created', jsonb_build_object('bulk', true, 'futureRule', false, 'decisionId', v_decision, 'productId', v_product_id)),
      (v_line.invoice_id, v_line.id, p_actor_id, 'opening_price_created', jsonb_build_object('bulk', true, 'futureRule', false, 'decisionId', v_decision, 'priceId', v_price_id, 'price', round(p_price, 2), 'priceCount', 1)),
      (v_line.invoice_id, v_line.id, p_actor_id, 'invoice_line_resolved', jsonb_build_object('bulk', true, 'futureRule', false, 'decisionId', v_decision, 'productId', v_product_id));
  END LOOP;

  FOR v_invoice_id IN
    SELECT DISTINCT invoice_id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)
  LOOP
    PERFORM public.refresh_supplier_invoice_processing_status(v_invoice_id);
  END LOOP;

  RETURN jsonb_build_object(
    'alreadyResolved', false,
    'decision', 'create_material',
    'decisionId', v_decision,
    'materialId', v_material_id,
    'productId', v_product_id,
    'priceId', v_price_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_bulk_rounding_discrepancy(
  p_line_ids uuid[],
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
  v_expected numeric;
  v_actual numeric;
  v_difference numeric;
  v_invoice_id uuid;
  v_decision uuid := gen_random_uuid();
BEGIN
  IF NOT public.is_approved_candid_admin() OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Not allowed to record a rounding difference' USING ERRCODE = '42501';
  END IF;

  p_line_ids := ARRAY(SELECT DISTINCT id FROM unnest(p_line_ids) AS id ORDER BY id);

  IF cardinality(p_line_ids) = 0 OR cardinality(p_line_ids) > 200 THEN
    RAISE EXCEPTION 'Select the invoice lines' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM (
    SELECT id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids) ORDER BY id FOR UPDATE
  ) locked;

  IF (SELECT count(*) FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)) <> cardinality(p_line_ids) THEN
    RAISE EXCEPTION 'Invoice line not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.supplier_invoice_lines AS line
    WHERE line.id = ANY (p_line_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.supplier_invoice_events AS event
        WHERE event.invoice_line_id = line.id
          AND event.action = 'line_corrected'
          AND event.metadata->>'rule' = 'rounding_discrepancy'
      )
  ) THEN
    RETURN jsonb_build_object('alreadyResolved', true, 'decision', 'rounding_discrepancy', 'changesInvoiceTotals', false);
  END IF;

  FOR v_line IN SELECT * FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids) ORDER BY id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.supplier_invoice_events
      WHERE invoice_line_id = v_line.id
        AND action = 'line_corrected'
        AND metadata->>'rule' = 'rounding_discrepancy'
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_invoice FROM public.supplier_invoices WHERE id = v_line.invoice_id FOR UPDATE;
    v_expected := round(v_line.raw_quantity * v_line.raw_unit_price, 2);
    v_actual := round(v_line.raw_line_total, 2);
    v_difference := abs(v_expected - v_actual);

    IF v_line.review_status NOT IN ('extraction_error', 'needs_review')
      OR v_invoice.supplier_id IS NULL
      OR v_invoice.extraction_status IS DISTINCT FROM 'extracted'
      OR v_line.raw_quantity IS NULL
      OR v_line.raw_unit_price IS NULL
      OR v_line.raw_line_total IS NULL
      OR v_difference <= 0
      OR v_difference > 0.02
    THEN
      RAISE EXCEPTION 'Only a genuine 1p or 2p difference can be recorded this way' USING ERRCODE = '23514';
    END IF;

    UPDATE public.supplier_invoice_lines
    SET
      review_status = 'needs_review',
      maths_warning = NULL,
      internal_note = '1p or 2p difference recorded. The quantity, unit price, line total, and invoice totals stay as extracted.'
    WHERE id = v_line.id;

    INSERT INTO public.supplier_invoice_events (invoice_id, invoice_line_id, actor_id, action, metadata)
    VALUES (
      v_line.invoice_id,
      v_line.id,
      p_actor_id,
      'line_corrected',
      jsonb_build_object(
        'rule', 'rounding_discrepancy',
        'bulk', true,
        'automatic', false,
        'futureRule', false,
        'decisionId', v_decision,
        'expectedTotal', v_expected,
        'invoiceLineTotal', v_actual,
        'difference', v_difference,
        'originalMathsWarning', v_line.maths_warning,
        'changesInvoiceTotals', false,
        'lineIds', to_jsonb(p_line_ids)
      )
    );
  END LOOP;

  FOR v_invoice_id IN
    SELECT DISTINCT invoice_id FROM public.supplier_invoice_lines WHERE id = ANY (p_line_ids)
  LOOP
    PERFORM public.refresh_supplier_invoice_processing_status(v_invoice_id);
  END LOOP;

  RETURN jsonb_build_object(
    'alreadyResolved', false,
    'decision', 'rounding_discrepancy',
    'decisionId', v_decision,
    'changesInvoiceTotals', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ignore_bulk_invoice_charges(uuid[], uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_bulk_invoice_products(uuid[], uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retain_bulk_historical_invoice_prices(uuid[], uuid, uuid, numeric, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_bulk_invoice_price(uuid[], uuid, uuid, numeric, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_bulk_invoice_purchase_units(uuid[], text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_bulk_material_from_invoice_lines(uuid[], uuid, text, text, numeric, numeric, numeric, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_bulk_rounding_discrepancy(uuid[], uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ignore_bulk_invoice_charges(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_bulk_invoice_products(uuid[], uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retain_bulk_historical_invoice_prices(uuid[], uuid, uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_bulk_invoice_price(uuid[], uuid, uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_bulk_invoice_purchase_units(uuid[], text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_bulk_material_from_invoice_lines(uuid[], uuid, text, text, numeric, numeric, numeric, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_bulk_rounding_discrepancy(uuid[], uuid) TO authenticated;

-- Align the single-line material creator with the litre catalogue unit.
-- This keeps the existing single-line description mapping. Bulk review does not use it.
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

  IF p_purchase_unit NOT IN ('sheet', 'roll', 'linear_metre', 'square_metre', 'unit', 'pack', 'litre') THEN
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

  PERFORM pg_advisory_xact_lock(hashtextextended(v_identity, 0));

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

  BEGIN
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
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'A material with this name and specification already exists'
        USING ERRCODE = '23505';
  END;

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

COMMIT;
