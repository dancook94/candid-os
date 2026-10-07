-- Resolve a supplier-invoice price change without rewriting price history.
-- Approval inserts one material_prices row. Keep and query insert none.
-- Current price stays the latest effective_date, then approved_at, then created_at.

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
      'invoice_line_resolved',
      'price_change_detected',
      'price_change_approved',
      'price_change_rejected',
      'price_change_queried'
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_destructive_invoice_line_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.material_prices
    WHERE source_type = 'supplier_invoice'
      AND source_reference = OLD.id::text
  ) THEN
    RAISE EXCEPTION 'This invoice line has an approved material price and cannot be replaced'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.supplier_product_description_mappings
    WHERE created_from_invoice_line_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'This invoice line created a product description mapping and cannot be replaced'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.supplier_invoice_ignore_rules
    WHERE created_from_invoice_line_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'This invoice line created an ignore rule and cannot be replaced'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.supplier_invoice_events
    WHERE invoice_line_id = OLD.id
      AND action IN (
        'material_created',
        'supplier_product_created',
        'opening_price_created',
        'invoice_line_resolved',
        'price_change_approved',
        'price_change_rejected'
      )
  ) THEN
    RAISE EXCEPTION 'This invoice line has a permanent decision and cannot be replaced'
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS supplier_invoice_lines_prevent_destructive_delete
  ON public.supplier_invoice_lines;
CREATE TRIGGER supplier_invoice_lines_prevent_destructive_delete
  BEFORE DELETE ON public.supplier_invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_destructive_invoice_line_delete();

CREATE OR REPLACE FUNCTION public.resolve_invoice_price_change(
  p_invoice_line_id uuid,
  p_decision text,
  p_expected_product_id uuid,
  p_expected_price_id uuid,
  p_expected_invoice_price numeric,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_line public.supplier_invoice_lines%ROWTYPE;
  v_invoice public.supplier_invoices%ROWTYPE;
  v_product public.material_supplier_products%ROWTYPE;
  v_current public.material_prices%ROWTYPE;
  v_existing public.material_prices%ROWTYPE;
  v_material_unit text;
  v_unit text;
  v_invoice_price numeric;
  v_price_id uuid;
  v_became_current boolean;
  v_current_after uuid;
  v_statuses text[];
  v_processing text;
  v_raw_unit text;
BEGIN
  IF NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Not allowed to resolve an invoice price'
      USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approve', 'keep', 'query') THEN
    RAISE EXCEPTION 'Choose approve, keep, or query'
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

  SELECT *
  INTO v_invoice
  FROM public.supplier_invoices
  WHERE id = v_line.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.material_prices
  WHERE source_type = 'supplier_invoice'
    AND source_reference = p_invoice_line_id::text;

  IF v_existing.id IS NOT NULL THEN
    IF p_decision = 'approve'
      AND round(v_existing.price, 2) = round(p_expected_invoice_price, 2)
      AND v_existing.material_supplier_product_id = p_expected_product_id
    THEN
      SELECT id
      INTO v_current_after
      FROM public.material_prices
      WHERE material_supplier_product_id = v_existing.material_supplier_product_id
      ORDER BY effective_date DESC, approved_at DESC, created_at DESC
      LIMIT 1;

      RETURN jsonb_build_object(
        'alreadyResolved', true,
        'decision', 'approve',
        'priceId', v_existing.id,
        'becameCurrent', v_current_after = v_existing.id
      );
    END IF;

    RAISE EXCEPTION 'This invoice line has already created a price'
      USING ERRCODE = '23505';
  END IF;

  IF p_decision = 'query' AND v_line.review_status = 'query' THEN
    RETURN jsonb_build_object('alreadyResolved', true, 'decision', 'query');
  END IF;

  IF p_decision = 'keep'
    AND v_line.review_status = 'processed'
    AND EXISTS (
      SELECT 1
      FROM public.supplier_invoice_events
      WHERE invoice_line_id = v_line.id
        AND action = 'price_change_rejected'
    )
  THEN
    RETURN jsonb_build_object('alreadyResolved', true, 'decision', 'keep');
  END IF;

  IF v_line.review_status NOT IN ('price_change', 'query') THEN
    RAISE EXCEPTION 'Only a price-change line can be resolved'
      USING ERRCODE = '23514';
  END IF;

  IF v_line.matched_supplier_product_id IS DISTINCT FROM p_expected_product_id THEN
    RAISE EXCEPTION 'The matched supplier product changed. Reload this invoice before deciding.'
      USING ERRCODE = '40001';
  END IF;

  SELECT *
  INTO v_product
  FROM public.material_supplier_products
  WHERE id = p_expected_product_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_product.active THEN
    RAISE EXCEPTION 'The matched supplier product changed. Reload this invoice before deciding.'
      USING ERRCODE = '40001';
  END IF;

  IF v_invoice.supplier_id IS DISTINCT FROM v_product.supplier_id THEN
    RAISE EXCEPTION 'The supplier product does not belong to this invoice supplier'
      USING ERRCODE = '23514';
  END IF;

  SELECT purchase_unit
  INTO v_material_unit
  FROM public.materials
  WHERE id = v_product.material_id;

  v_raw_unit := lower(btrim(COALESCE(v_line.reviewed_unit, v_line.raw_unit, '')));
  v_unit := CASE v_raw_unit
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

  IF v_invoice_price IS NULL OR v_invoice_price <= 0 THEN
    RAISE EXCEPTION 'The invoice unit price must be greater than zero'
      USING ERRCODE = '23514';
  END IF;

  IF round(p_expected_invoice_price, 2) IS DISTINCT FROM v_invoice_price THEN
    RAISE EXCEPTION 'The invoice price changed. Reload this invoice before deciding.'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.material_prices
  WHERE material_supplier_product_id = v_product.id
  FOR UPDATE;

  SELECT *
  INTO v_current
  FROM public.material_prices
  WHERE material_supplier_product_id = v_product.id
  ORDER BY effective_date DESC, approved_at DESC, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This product has no current approved price'
      USING ERRCODE = '23514';
  END IF;

  IF v_current.id IS DISTINCT FROM p_expected_price_id THEN
    RAISE EXCEPTION 'The current approved price changed. Reload this invoice before deciding.'
      USING ERRCODE = '40001';
  END IF;

  IF v_current.price_unit IS DISTINCT FROM v_material_unit THEN
    RAISE EXCEPTION 'The invoice unit does not match the material purchase unit'
      USING ERRCODE = '23514';
  END IF;

  IF round(v_current.price, 2) = v_invoice_price THEN
    RAISE EXCEPTION 'The invoice price now matches the current approved price. Reload this invoice.'
      USING ERRCODE = '40001';
  END IF;

  IF p_decision = 'approve' AND v_invoice.invoice_date IS NULL THEN
    RAISE EXCEPTION 'The invoice needs a date before a price can be approved'
      USING ERRCODE = '23514';
  END IF;

  IF p_decision = 'approve' THEN
    BEGIN
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
        v_product.id,
        v_invoice_price,
        'GBP',
        v_material_unit,
        v_invoice.invoice_date,
        auth.uid(),
        'supplier_invoice',
        p_invoice_line_id::text
      )
      RETURNING id INTO v_price_id;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT *
        INTO v_existing
        FROM public.material_prices
        WHERE source_type = 'supplier_invoice'
          AND source_reference = p_invoice_line_id::text;

        IF v_existing.id IS NOT NULL
          AND round(v_existing.price, 2) = v_invoice_price
          AND v_existing.material_supplier_product_id = v_product.id
        THEN
          RETURN jsonb_build_object(
            'alreadyResolved', true,
            'decision', 'approve',
            'priceId', v_existing.id
          );
        END IF;

        RAISE EXCEPTION 'This invoice line has already created a price'
          USING ERRCODE = '23505';
    END;

    SELECT id
    INTO v_current_after
    FROM public.material_prices
    WHERE material_supplier_product_id = v_product.id
    ORDER BY effective_date DESC, approved_at DESC, created_at DESC
    LIMIT 1;

    v_became_current := v_current_after = v_price_id;

    UPDATE public.supplier_invoice_lines
    SET
      review_status = 'processed',
      internal_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), internal_note)
    WHERE id = v_line.id;

    INSERT INTO public.supplier_invoice_events (
      invoice_id, invoice_line_id, actor_id, action, metadata
    )
    VALUES (
      v_invoice.id,
      v_line.id,
      auth.uid(),
      'price_change_approved',
      jsonb_build_object(
        'priceId', v_price_id,
        'productId', v_product.id,
        'invoicePrice', v_invoice_price,
        'previousPriceId', v_current.id,
        'previousPrice', v_current.price,
        'previousEffectiveDate', v_current.effective_date,
        'effectiveDate', v_invoice.invoice_date,
        'priceUnit', v_material_unit,
        'becameCurrent', v_became_current
      )
    );
  ELSIF p_decision = 'keep' THEN
    UPDATE public.supplier_invoice_lines
    SET
      review_status = 'processed',
      internal_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), internal_note)
    WHERE id = v_line.id;

    INSERT INTO public.supplier_invoice_events (
      invoice_id, invoice_line_id, actor_id, action, metadata
    )
    VALUES (
      v_invoice.id,
      v_line.id,
      auth.uid(),
      'price_change_rejected',
      jsonb_build_object(
        'productId', v_product.id,
        'invoicePrice', v_invoice_price,
        'currentPriceId', v_current.id,
        'currentPrice', v_current.price,
        'currentEffectiveDate', v_current.effective_date,
        'priceUnit', v_material_unit
      )
    );
  ELSE
    UPDATE public.supplier_invoice_lines
    SET
      review_status = 'query',
      internal_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), internal_note)
    WHERE id = v_line.id;

    INSERT INTO public.supplier_invoice_events (
      invoice_id, invoice_line_id, actor_id, action, metadata
    )
    VALUES (
      v_invoice.id,
      v_line.id,
      auth.uid(),
      'price_change_queried',
      jsonb_build_object(
        'productId', v_product.id,
        'invoicePrice', v_invoice_price,
        'currentPriceId', v_current.id,
        'currentPrice', v_current.price,
        'currentEffectiveDate', v_current.effective_date,
        'priceUnit', v_material_unit,
        'note', NULLIF(btrim(COALESCE(p_note, '')), '')
      )
    );
  END IF;

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
    'decision', p_decision,
    'priceId', v_price_id,
    'becameCurrent', COALESCE(v_became_current, false),
    'productId', v_product.id,
    'materialId', v_product.material_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_invoice_price_change(
  uuid, text, uuid, uuid, numeric, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_invoice_price_change(
  uuid, text, uuid, uuid, numeric, text
) TO authenticated;

COMMIT;
