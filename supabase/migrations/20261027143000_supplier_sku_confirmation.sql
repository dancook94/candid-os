-- Confirm a blank catalogue supplier SKU from a verified invoice line.
-- This updates only material_supplier_products.supplier_sku and writes one
-- confirmation row plus one invoice event.
-- It does not change material descriptions, dimensions, units, or prices.
-- A supplier SKU can change only inside confirm_supplier_sku.
-- Apply this file manually to the Test project only. Do not push it from config.toml.

BEGIN;

CREATE TABLE IF NOT EXISTS public.supplier_sku_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_supplier_product_id uuid NOT NULL UNIQUE
    REFERENCES public.material_supplier_products (id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  invoice_line_id uuid NOT NULL REFERENCES public.supplier_invoice_lines (id) ON DELETE RESTRICT,
  confirmed_sku text NOT NULL,
  previous_sku text,
  confirmed_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_sku_confirmations_sku_not_blank CHECK (btrim(confirmed_sku) <> ''),
  CONSTRAINT supplier_sku_confirmations_previous_blank CHECK (
    previous_sku IS NULL OR btrim(previous_sku) = ''
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_sku_confirmations_supplier_sku_idx
  ON public.supplier_sku_confirmations (supplier_id, lower(confirmed_sku));

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
      'price_change_queried',
      'supplier_sku_confirmed'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_events_one_supplier_sku_idx
  ON public.supplier_invoice_events ((metadata->>'productId'))
  WHERE action = 'supplier_sku_confirmed'
    AND NULLIF(metadata->>'productId', '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.supplier_sku_details_conflict(
  p_invoice_description text,
  p_product_text text,
  p_thickness_mm numeric,
  p_width_mm numeric,
  p_height_mm numeric,
  p_length_mm numeric
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_invoice text := lower(COALESCE(p_invoice_description, ''));
  v_product text := lower(COALESCE(p_product_text, ''));
  v_invoice_families text[] := ARRAY[]::text[];
  v_product_families text[] := ARRAY[]::text[];
  v_invoice_grades text[] := ARRAY[]::text[];
  v_product_grades text[] := ARRAY[]::text[];
  v_without text;
  v_thickness numeric;
  v_pair_count integer;
  v_left numeric;
  v_right numeric;
  v_product_left numeric;
  v_product_right numeric;
  v_roll_count integer;
  v_roll_width numeric;
  v_roll_length numeric;
  v_invoice_permanent boolean;
  v_invoice_removable boolean;
  v_product_permanent boolean;
  v_product_removable boolean;
BEGIN
  IF v_invoice ~ '\m(foamalite|foamex)\M' OR v_invoice ~ 'foam pvc' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'foamalite');
  END IF;
  IF v_invoice ~ '\m(dibond|acm)\M' OR v_invoice ~ 'aluminium composite' OR v_invoice ~ 'aluminum composite' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'dibond');
  END IF;
  IF v_invoice ~ '\m(acrylic|perspex|plexiglass)\M' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'acrylic');
  END IF;
  IF v_invoice ~ '\m(vinyl|briteline|monomeric|polymeric)\M' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'vinyl');
  END IF;
  IF v_invoice ~ '\mbanner\M' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'banner');
  END IF;
  IF v_invoice ~ '\mpaper\M' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'paper');
  END IF;
  IF v_invoice ~ '\m(fabric|textile)\M' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'fabric');
  END IF;

  IF v_product ~ '\m(foamalite|foamex)\M' OR v_product ~ 'foam pvc' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'foamalite');
  END IF;
  IF v_product ~ '\m(dibond|acm)\M' OR v_product ~ 'aluminium composite' OR v_product ~ 'aluminum composite' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'dibond');
  END IF;
  IF v_product ~ '\m(acrylic|perspex|plexiglass)\M' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'acrylic');
  END IF;
  IF v_product ~ '\m(vinyl|briteline|monomeric|polymeric)\M' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'vinyl');
  END IF;
  IF v_product ~ '\mbanner\M' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'banner');
  END IF;
  IF v_product ~ '\mpaper\M' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'paper');
  END IF;
  IF v_product ~ '\m(fabric|textile)\M' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'fabric');
  END IF;

  IF cardinality(v_invoice_families) = 1
    AND cardinality(v_product_families) = 1
    AND v_invoice_families[1] IS DISTINCT FROM v_product_families[1]
  THEN
    RETURN true;
  END IF;

  SELECT COALESCE(array_agg(token), ARRAY[]::text[])
  INTO v_invoice_grades
  FROM (
    SELECT 'pq' || lower(match[1]) AS token
    FROM regexp_matches(COALESCE(p_invoice_description, ''), 'PQ\s*([0-9]+)', 'gi') AS match
    UNION
    SELECT 'fg-' || lower(match[1])
    FROM regexp_matches(COALESCE(p_invoice_description, ''), 'FG-([0-9]+)', 'gi') AS match
  ) AS grades;

  SELECT COALESCE(array_agg(token), ARRAY[]::text[])
  INTO v_product_grades
  FROM (
    SELECT 'pq' || lower(match[1]) AS token
    FROM regexp_matches(COALESCE(p_product_text, ''), 'PQ\s*([0-9]+)', 'gi') AS match
    UNION
    SELECT 'fg-' || lower(match[1])
    FROM regexp_matches(COALESCE(p_product_text, ''), 'FG-([0-9]+)', 'gi') AS match
  ) AS grades;

  IF cardinality(v_invoice_grades) > 0
    AND cardinality(v_product_grades) > 0
    AND NOT (v_invoice_grades && v_product_grades)
  THEN
    RETURN true;
  END IF;

  v_without := regexp_replace(
    COALESCE(p_invoice_description, ''),
    '([0-9]+(\.[0-9]+)?)[[:space:]]*(mm)?[[:space:]]*[x×][[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*(mm)?',
    ' ',
    'gi'
  );
  v_thickness := substring(v_without from '([0-9]+(\.[0-9]+)?)[[:space:]]*mm')::numeric;

  IF v_thickness IS NOT NULL
    AND v_thickness > 0
    AND v_thickness <= 100
    AND p_thickness_mm IS NOT NULL
    AND abs(v_thickness - p_thickness_mm) >= 0.15
  THEN
    RETURN true;
  END IF;

  IF p_width_mm IS NOT NULL AND p_invoice_description ~* 'slit to\s+[0-9]' THEN
    IF EXISTS (
      SELECT 1
      FROM regexp_matches(p_invoice_description, 'slit to[[:space:]]+([0-9]{3,4}(\.[0-9]+)?)[[:space:]]*mm', 'gi') AS match
      WHERE round(match[1]::numeric) <> round(p_width_mm)
    ) THEN
      RETURN true;
    END IF;
  END IF;

  -- Sheet sizes include 1220mm x 2440mm, 1220mm x 2440 and 2440 x 1220mm.
  -- Roll sizes include 1370mm x 50m and 50m x 1370mm.
  SELECT count(*)
  INTO v_pair_count
  FROM (
    SELECT DISTINCT
      least(round(match[1]::numeric), round(match[3]::numeric)) AS low_mm,
      greatest(round(match[1]::numeric), round(match[3]::numeric)) AS high_mm
    FROM regexp_matches(
      COALESCE(p_invoice_description, ''),
      '([0-9]{3,4})[[:space:]]*(mm)?[[:space:]]*[x×][[:space:]]*([0-9]{3,4})[[:space:]]*(mm)?',
      'gi'
    ) AS match
    WHERE match[2] IS NOT NULL OR match[4] IS NOT NULL
  ) AS pairs;

  IF v_pair_count = 1 AND p_width_mm IS NOT NULL AND p_height_mm IS NOT NULL THEN
    SELECT low_mm, high_mm
    INTO v_left, v_right
    FROM (
      SELECT DISTINCT
        least(round(match[1]::numeric), round(match[3]::numeric)) AS low_mm,
        greatest(round(match[1]::numeric), round(match[3]::numeric)) AS high_mm
      FROM regexp_matches(
        COALESCE(p_invoice_description, ''),
        '([0-9]{3,4})[[:space:]]*(mm)?[[:space:]]*[x×][[:space:]]*([0-9]{3,4})[[:space:]]*(mm)?',
        'gi'
      ) AS match
      WHERE match[2] IS NOT NULL OR match[4] IS NOT NULL
    ) AS pairs;

    v_product_left := least(round(p_width_mm), round(p_height_mm));
    v_product_right := greatest(round(p_width_mm), round(p_height_mm));

    IF v_left <> v_product_left OR v_right <> v_product_right THEN
      RETURN true;
    END IF;
  END IF;

  SELECT count(*)
  INTO v_roll_count
  FROM (
    SELECT DISTINCT round(width_mm) AS width_mm, round(length_mm) AS length_mm
    FROM (
      SELECT match[1]::numeric AS width_mm, match[3]::numeric * 1000 AS length_mm
      FROM regexp_matches(
        COALESCE(p_invoice_description, ''),
        '([0-9]+(\.[0-9]+)?)[[:space:]]*mm[[:space:]]*[x×][[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*m\M',
        'gi'
      ) AS match
      UNION ALL
      SELECT match[3]::numeric AS width_mm, match[1]::numeric * 1000 AS length_mm
      FROM regexp_matches(
        COALESCE(p_invoice_description, ''),
        '([0-9]+(\.[0-9]+)?)[[:space:]]*m[[:space:]]*[x×][[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*mm\M',
        'gi'
      ) AS match
    ) AS rolls
  ) AS unique_rolls;

  IF v_roll_count = 1 THEN
    SELECT width_mm, length_mm
    INTO v_roll_width, v_roll_length
    FROM (
      SELECT DISTINCT round(width_mm) AS width_mm, round(length_mm) AS length_mm
      FROM (
        SELECT match[1]::numeric AS width_mm, match[3]::numeric * 1000 AS length_mm
        FROM regexp_matches(
          COALESCE(p_invoice_description, ''),
          '([0-9]+(\.[0-9]+)?)[[:space:]]*mm[[:space:]]*[x×][[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*m\M',
          'gi'
        ) AS match
        UNION ALL
        SELECT match[3]::numeric AS width_mm, match[1]::numeric * 1000 AS length_mm
        FROM regexp_matches(
          COALESCE(p_invoice_description, ''),
          '([0-9]+(\.[0-9]+)?)[[:space:]]*m[[:space:]]*[x×][[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*mm\M',
          'gi'
        ) AS match
      ) AS rolls
    ) AS unique_rolls;

    IF p_width_mm IS NOT NULL AND round(v_roll_width) <> round(p_width_mm) THEN
      RETURN true;
    END IF;

    IF p_length_mm IS NOT NULL AND abs(v_roll_length - p_length_mm) > 1 THEN
      RETURN true;
    END IF;
  END IF;

  v_invoice_permanent := v_invoice ~ '\mpermanent\M';
  v_invoice_removable := v_invoice ~ '\mremovable\M';
  v_product_permanent := v_product ~ '\mpermanent\M';
  v_product_removable := v_product ~ '\mremovable\M';

  IF v_invoice_permanent <> v_invoice_removable
    AND v_product_permanent <> v_product_removable
    AND v_invoice_permanent <> v_product_permanent
  THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_supplier_sku(
  p_invoice_line_id uuid,
  p_expected_product_id uuid,
  p_expected_sku text,
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
  v_existing public.supplier_sku_confirmations%ROWTYPE;
  v_material public.materials%ROWTYPE;
  v_sku text;
  v_expected text;
  v_description text;
  v_description_count integer;
  v_confirmation_id uuid;
  v_unit text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Not allowed to confirm a supplier SKU'
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
    RAISE EXCEPTION 'The SKU confirmation must be recorded against the signed-in administrator'
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
    RAISE EXCEPTION 'An ignored invoice cannot confirm a supplier SKU'
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

  v_sku := public.normalize_material_label(v_line.raw_supplier_sku);
  v_expected := public.normalize_material_label(p_expected_sku);
  v_description := lower(btrim(regexp_replace(COALESCE(v_line.raw_description, ''), '\s+', ' ', 'g')));

  IF v_sku IS NULL OR v_expected IS NULL OR lower(v_sku) IS DISTINCT FROM lower(v_expected) THEN
    RAISE EXCEPTION 'The confirmed SKU must be the SKU printed on the invoice line'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.supplier_sku_confirmations
  WHERE material_supplier_product_id = v_product.id
  FOR UPDATE;

  IF FOUND THEN
    IF lower(btrim(v_existing.confirmed_sku)) = lower(v_sku)
      AND lower(btrim(COALESCE(v_product.supplier_sku, ''))) = lower(v_sku)
    THEN
      RETURN jsonb_build_object(
        'alreadyConfirmed', true,
        'productId', v_product.id,
        'sku', v_product.supplier_sku
      );
    END IF;

    RAISE EXCEPTION 'This product already has a different confirmed SKU'
      USING ERRCODE = '23514';
  END IF;

  IF NULLIF(btrim(COALESCE(v_product.supplier_sku, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'The catalogue SKU is no longer blank'
      USING ERRCODE = '23514';
  END IF;

  IF v_line.match_confidence IS DISTINCT FROM 'high'
    OR v_line.match_method NOT IN ('description', 'mapping')
    OR v_line.matched_supplier_product_id IS DISTINCT FROM v_product.id
  THEN
    RAISE EXCEPTION 'The supplier product match is not verified'
      USING ERRCODE = '23514';
  END IF;

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
  ELSE
    IF v_product.normalized_description IS DISTINCT FROM v_description THEN
      RAISE EXCEPTION 'The invoice description does not identify this one product'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*)
    INTO v_description_count
    FROM public.material_supplier_products
    WHERE supplier_id = v_product.supplier_id
      AND active
      AND normalized_description = v_description;

    IF v_description_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'The invoice description does not identify this one product'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.material_supplier_products
    WHERE supplier_id = v_product.supplier_id
      AND id IS DISTINCT FROM v_product.id
      AND lower(btrim(COALESCE(supplier_sku, ''))) = lower(v_sku)
  ) THEN
    RAISE EXCEPTION 'This supplier SKU is already used by another product'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.supplier_invoice_lines AS other_line
    JOIN public.supplier_invoices AS other_invoice
      ON other_invoice.id = other_line.invoice_id
    WHERE other_line.id IS DISTINCT FROM v_line.id
      AND other_invoice.supplier_id = v_product.supplier_id
      AND other_invoice.processing_status IS DISTINCT FROM 'ignored'
      AND other_line.matched_supplier_product_id = v_product.id
      AND other_line.match_confidence = 'high'
      AND other_line.match_method IN ('description', 'mapping')
      AND lower(btrim(COALESCE(other_line.raw_supplier_sku, ''))) <> ''
      AND lower(btrim(other_line.raw_supplier_sku)) IS DISTINCT FROM lower(v_sku)
  ) THEN
    RAISE EXCEPTION 'Another invoice line records a different SKU for this product'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.supplier_invoice_lines AS other_line
    JOIN public.supplier_invoices AS other_invoice
      ON other_invoice.id = other_line.invoice_id
    WHERE other_line.id IS DISTINCT FROM v_line.id
      AND other_invoice.supplier_id = v_product.supplier_id
      AND other_invoice.processing_status IS DISTINCT FROM 'ignored'
      AND other_line.match_confidence = 'high'
      AND other_line.match_method IN ('description', 'mapping')
      AND lower(btrim(COALESCE(other_line.raw_supplier_sku, ''))) = lower(v_sku)
      AND other_line.matched_supplier_product_id IS DISTINCT FROM v_product.id
  ) THEN
    RAISE EXCEPTION 'This SKU is already matched to a different supplier product'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_material
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

  IF v_unit IS NULL OR v_unit IS DISTINCT FROM v_material.purchase_unit THEN
    RAISE EXCEPTION 'The invoice unit does not match the material purchase unit'
      USING ERRCODE = '23514';
  END IF;

  IF public.supplier_sku_details_conflict(
    v_line.raw_description,
    COALESCE(v_material.name, '') || ' ' || v_product.supplier_description,
    v_material.thickness_mm,
    v_material.purchase_width_mm,
    v_material.purchase_height_mm,
    v_material.purchase_length_mm
  ) THEN
    RAISE EXCEPTION 'The invoice line conflicts with the product specification'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.material_supplier_products
  SET supplier_sku = v_sku
  WHERE id = v_product.id
    AND NULLIF(btrim(COALESCE(supplier_sku, '')), '') IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The catalogue SKU is no longer blank'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.supplier_sku_confirmations (
    material_supplier_product_id,
    supplier_id,
    invoice_line_id,
    confirmed_sku,
    previous_sku,
    confirmed_by,
    confirmed_at
  )
  VALUES (
    v_product.id,
    v_product.supplier_id,
    v_line.id,
    v_sku,
    NULL,
    p_actor_id,
    now()
  )
  RETURNING id INTO v_confirmation_id;

  INSERT INTO public.supplier_invoice_events (
    invoice_id,
    invoice_line_id,
    actor_id,
    action,
    metadata
  )
  VALUES (
    v_invoice.id,
    v_line.id,
    p_actor_id,
    'supplier_sku_confirmed',
    jsonb_build_object(
      'rule', 'supplier_sku_confirmed',
      'productId', v_product.id,
      'supplierId', v_product.supplier_id,
      'invoiceLineId', v_line.id,
      'previousSku', NULL,
      'confirmedSku', v_sku,
      'confirmedBy', p_actor_id,
      'confirmedAt', now()
    )
  );

  RETURN jsonb_build_object(
    'alreadyConfirmed', false,
    'confirmationId', v_confirmation_id,
    'productId', v_product.id,
    'sku', v_sku
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_material_supplier_product_sku()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_owner name;
BEGIN
  IF NEW.supplier_sku IS NOT DISTINCT FROM OLD.supplier_sku THEN
    RETURN NEW;
  END IF;

  SELECT pg_catalog.pg_get_userbyid(proc.proowner)
  INTO v_owner
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS ns
    ON ns.oid = proc.pronamespace
  WHERE ns.nspname = 'public'
    AND proc.proname = 'confirm_supplier_sku'
    AND pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'uuid, uuid, text, uuid';

  IF v_owner IS NULL OR current_user IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'A supplier SKU can only be saved by confirming an invoice line'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS material_supplier_products_guard_supplier_sku
  ON public.material_supplier_products;
CREATE TRIGGER material_supplier_products_guard_supplier_sku
  BEFORE UPDATE OF supplier_sku ON public.material_supplier_products
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_material_supplier_product_sku();

ALTER TABLE public.supplier_sku_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_sku_confirmations_select_admin
  ON public.supplier_sku_confirmations;
CREATE POLICY supplier_sku_confirmations_select_admin
  ON public.supplier_sku_confirmations FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

REVOKE ALL ON TABLE public.supplier_sku_confirmations FROM PUBLIC, anon;
GRANT SELECT ON public.supplier_sku_confirmations TO authenticated;

REVOKE ALL ON FUNCTION public.supplier_sku_details_conflict(text, text, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_supplier_sku(uuid, uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_material_supplier_product_sku() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.confirm_supplier_sku(uuid, uuid, text, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_material_supplier_product_sku()
  TO authenticated, service_role;

COMMIT;
