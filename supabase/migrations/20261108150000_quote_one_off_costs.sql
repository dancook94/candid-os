-- Quote one-off / manual internal purchase costs (Test-safe; additive).

ALTER TABLE public.quote_item_cost_components
  ADD COLUMN IF NOT EXISTS supplier_reference text,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.quote_item_cost_components
  DROP CONSTRAINT IF EXISTS quote_item_cost_components_type_check;

ALTER TABLE public.quote_item_cost_components
  ADD CONSTRAINT quote_item_cost_components_type_check CHECK (
    component_type = ANY (
      ARRAY[
        'printing',
        'finishing',
        'labour',
        'installation',
        'delivery',
        'outsourcing',
        'other',
        'one_off'
      ]::text[]
    )
  );

CREATE OR REPLACE FUNCTION public.save_composite_quote_line_cost(
  p_item_id uuid,
  p_line_quantity numeric,
  p_line_sort integer,
  p_cost jsonb,
  p_existing_materials jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_cost_id uuid;
  v_material jsonb;
  v_component jsonb;
  v_sort integer := 0;
  v_component_sort integer := 0;
  v_count integer := 0;
  v_all_complete boolean := true;
  v_material_sum numeric(12, 2) := 0;
  v_additional numeric(12, 2) := 0;
  v_default_width numeric(12, 2);
  v_default_height numeric(12, 2);
  v_source text;
  v_basis text;
  v_inherit_dimensions boolean;
  v_inherit_quantity boolean;
  v_width numeric(12, 2);
  v_height numeric(12, 2);
  v_quantity numeric(12, 4);
  v_rate numeric(12, 4);
  v_area numeric(14, 6);
  v_costed_area numeric(14, 6);
  v_calculated numeric(12, 2);
  v_manual numeric(12, 2);
  v_material_cost numeric(12, 2);
  v_complete boolean;
  v_reason text;
  v_material_id uuid;
  v_product_id uuid;
  v_price_id uuid;
  v_found boolean;
  v_price numeric;
  v_price_unit text;
  v_purchase_width numeric;
  v_purchase_height numeric;
  v_purchase_length numeric;
  v_material_name text;
  v_supplier_name text;
  v_saved_material_name text;
  v_saved_supplier_name text;
  v_use_current_rate boolean;
  v_prior jsonb;
  v_component_id uuid;
  v_locked boolean;
  v_snapshotted_at timestamptz;
  v_purchase_unit text;
  v_wastage numeric(6, 4);
  v_component_quantity numeric;
  v_component_unit_cost numeric;
BEGIN
  IF NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Admin access required'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_cost -> 'materials') <> 'array' THEN
    RAISE EXCEPTION 'Materials must be a list'
      USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS quote_material_snapshot_claims (
    component_id uuid PRIMARY KEY
  ) ON COMMIT DELETE ROWS;

  v_default_width := NULLIF(p_cost ->> 'default_finished_width_mm', '')::numeric;
  v_default_height := NULLIF(p_cost ->> 'default_finished_height_mm', '')::numeric;

  IF v_default_width IS NOT NULL THEN
    v_default_width := round(v_default_width, 2);
    IF v_default_width <= 0 THEN
      v_default_width := NULL;
    END IF;
  END IF;

  IF v_default_height IS NOT NULL THEN
    v_default_height := round(v_default_height, 2);
    IF v_default_height <= 0 THEN
      v_default_height := NULL;
    END IF;
  END IF;

  IF p_cost ? 'components' AND jsonb_typeof(p_cost -> 'components') = 'array' THEN
    FOR v_component IN
      SELECT value
      FROM jsonb_array_elements(p_cost -> 'components')
    LOOP
      v_additional := v_additional + round(
        (v_component ->> 'quantity')::numeric
          * round((v_component ->> 'unit_cost')::numeric, 2),
        2
      );
    END LOOP;
  END IF;

  INSERT INTO public.quote_item_costs (
    quote_item_id,
    cost_kind,
    cost_basis,
    costing_status,
    material_id,
    material_supplier_product_id,
    material_price_id,
    material_name,
    supplier_name,
    rate_per_sqm,
    finished_width_mm,
    finished_height_mm,
    quantity,
    wastage_rate,
    area_sqm,
    costed_area_sqm,
    calculated_material_cost,
    manual_material_cost,
    material_cost,
    additional_cost,
    total_estimated_cost,
    incomplete_reason,
    snapshotted_by,
    default_finished_width_mm,
    default_finished_height_mm
  )
  VALUES (
    p_item_id,
    'composite',
    'composite',
    'incomplete',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    v_additional,
    NULL,
    'No materials have been costed',
    auth.uid(),
    v_default_width,
    v_default_height
  )
  RETURNING id INTO v_cost_id;

  FOR v_material IN
    SELECT value
    FROM jsonb_array_elements(p_cost -> 'materials')
  LOOP
    v_sort := v_sort + 1;
    v_count := v_count + 1;
    v_prior := NULL;
    v_component_id := NULL;
    v_locked := false;
    v_snapshotted_at := NULL;
    v_use_current_rate := coalesce((v_material ->> 'use_current_rate')::boolean, false);

    IF coalesce(v_material ->> 'intent', '') IS DISTINCT FROM 'add'
      AND NULLIF(btrim(v_material ->> 'id'), '') IS NOT NULL THEN
      v_component_id := (v_material ->> 'id')::uuid;

      IF EXISTS (
        SELECT 1
        FROM quote_material_snapshot_claims
        WHERE component_id = v_component_id
      ) THEN
        RAISE EXCEPTION 'Material snapshot was already used on this save'
          USING ERRCODE = '22023';
      END IF;

      SELECT element
      INTO v_prior
      FROM jsonb_array_elements(coalesce(p_existing_materials, '[]'::jsonb)) AS element
      WHERE element ->> 'id' = v_component_id::text
      LIMIT 1;

      IF v_prior IS NULL THEN
        RAISE EXCEPTION 'Material snapshot does not belong to this quote version'
          USING ERRCODE = '22023';
      END IF;

      INSERT INTO quote_material_snapshot_claims (component_id)
      VALUES (v_component_id);
    ELSIF coalesce(v_material ->> 'intent', '') IS DISTINCT FROM 'add' THEN
      RAISE EXCEPTION 'Material component id is required'
        USING ERRCODE = '22023';
    END IF;

    IF v_prior IS NOT NULL AND NOT v_use_current_rate THEN
      v_locked := true;
      v_source := v_prior ->> 'source_kind';
      v_basis := v_prior ->> 'cost_basis';
    ELSE
      v_source := v_material ->> 'source_kind';
      v_basis := v_material ->> 'cost_basis';
    END IF;

    IF v_source NOT IN ('approved_material', 'custom_material') THEN
      RAISE EXCEPTION 'Unknown material source'
        USING ERRCODE = '22023';
    END IF;

    IF v_basis NOT IN ('area', 'consumption', 'manual') THEN
      RAISE EXCEPTION 'Unknown material cost basis'
        USING ERRCODE = '22023';
    END IF;

    v_inherit_dimensions := coalesce((v_material ->> 'inherit_dimensions')::boolean, true);
    v_inherit_quantity := coalesce((v_material ->> 'inherit_quantity')::boolean, true);
    v_width := NULL;
    v_height := NULL;
    v_quantity := NULL;
    v_rate := NULL;
    v_area := NULL;
    v_costed_area := NULL;
    v_calculated := NULL;
    v_manual := NULL;
    v_material_cost := NULL;
    v_complete := false;
    v_reason := NULL;
    v_material_id := NULL;
    v_product_id := NULL;
    v_price_id := NULL;
    v_found := false;
    v_price := NULL;
    v_price_unit := NULL;
    v_purchase_width := NULL;
    v_purchase_height := NULL;
    v_purchase_length := NULL;
    v_saved_material_name := NULLIF(btrim(v_material ->> 'material_name'), '');
    v_saved_supplier_name := NULLIF(btrim(v_material ->> 'supplier_name'), '');
    v_material_name := v_saved_material_name;
    v_supplier_name := v_saved_supplier_name;
    v_purchase_unit := NULL;

    IF v_basis = 'area' THEN
      IF v_inherit_dimensions THEN
        v_width := v_default_width;
        v_height := v_default_height;
      ELSE
        v_width := NULLIF(v_material ->> 'finished_width_mm', '')::numeric;
        v_height := NULLIF(v_material ->> 'finished_height_mm', '')::numeric;
      END IF;

      IF v_inherit_quantity THEN
        v_quantity := p_line_quantity;
      ELSE
        v_quantity := NULLIF(v_material ->> 'quantity', '')::numeric;
      END IF;
    ELSIF v_basis = 'consumption' THEN
      IF v_inherit_quantity THEN
        v_quantity := p_line_quantity;
      ELSE
        v_quantity := NULLIF(v_material ->> 'quantity', '')::numeric;
      END IF;
    END IF;

    IF v_width IS NOT NULL THEN
      v_width := round(v_width, 2);
      IF v_width <= 0 THEN
        v_width := NULL;
      END IF;
    END IF;

    IF v_height IS NOT NULL THEN
      v_height := round(v_height, 2);
      IF v_height <= 0 THEN
        v_height := NULL;
      END IF;
    END IF;

    IF v_quantity IS NOT NULL THEN
      v_quantity := round(v_quantity, 4);
      IF v_quantity <= 0 THEN
        v_quantity := NULL;
      END IF;
    END IF;

    IF v_source = 'approved_material' THEN
      v_material_id := NULLIF(v_material ->> 'material_id', '')::uuid;
      v_product_id := NULLIF(v_material ->> 'material_supplier_product_id', '')::uuid;
      v_price_id := NULLIF(v_material ->> 'material_price_id', '')::uuid;

      SELECT
        price.price,
        price.price_unit,
        material.purchase_width_mm,
        material.purchase_height_mm,
        material.purchase_length_mm,
        material.name,
        supplier.name
      INTO
        v_price,
        v_price_unit,
        v_purchase_width,
        v_purchase_height,
        v_purchase_length,
        v_material_name,
        v_supplier_name
      FROM public.material_prices AS price
      JOIN public.material_supplier_products AS product
        ON product.id = price.material_supplier_product_id
      JOIN public.materials AS material
        ON material.id = product.material_id
      JOIN public.suppliers AS supplier
        ON supplier.id = product.supplier_id
      WHERE price.id = v_price_id
        AND product.id = v_product_id
        AND material.id = v_material_id;

      v_found := FOUND;

      IF v_found THEN
        v_purchase_unit := v_price_unit;
        IF NOT v_use_current_rate THEN
          v_material_name := coalesce(v_saved_material_name, v_material_name);
          v_supplier_name := coalesce(v_saved_supplier_name, v_supplier_name);
        END IF;
      ELSE
        v_material_id := NULL;
        v_product_id := NULL;
        v_price_id := NULL;
        v_price_unit := NULL;
        v_material_name := v_saved_material_name;
        v_supplier_name := v_saved_supplier_name;
      END IF;
    END IF;

    IF v_locked THEN
      NULL;
    ELSIF v_basis = 'manual' THEN
      IF NULLIF(btrim(v_material ->> 'manual_material_cost'), '') IS NOT NULL THEN
        v_manual := round((v_material ->> 'manual_material_cost')::numeric, 2);
        IF v_manual < 0 THEN
          RAISE EXCEPTION 'Material cost cannot be negative'
            USING ERRCODE = '22023';
        END IF;
        v_material_cost := v_manual;
        v_complete := true;
      ELSE
        v_reason := 'Manual material cost is missing';
      END IF;
    ELSIF v_source = 'approved_material' AND NOT v_found THEN
      v_reason := 'Approved material price was not found';
    ELSE
      IF v_source = 'approved_material' AND v_use_current_rate AND v_basis = 'area' THEN
        v_rate := public.quote_material_rate_per_sqm(
          v_price,
          v_price_unit,
          v_purchase_width,
          v_purchase_height,
          v_purchase_length
        );
      ELSIF v_source = 'approved_material' AND v_use_current_rate AND v_basis = 'consumption' THEN
        IF v_price IS NOT NULL AND v_price > 0 THEN
          v_rate := round(v_price, 4);
        END IF;
      ELSIF v_source = 'approved_material' THEN
        v_rate := NULL;
      ELSE
        v_rate := round(coalesce(
          NULLIF(v_material ->> 'snapshotted_rate', '')::numeric,
          NULLIF(v_material ->> 'rate', '')::numeric,
          NULLIF(v_material ->> 'rate_per_sqm', '')::numeric
        ), 4);
        IF v_basis = 'area' THEN
          v_purchase_unit := 'square_metre';
        ELSE
          v_purchase_unit := coalesce(
            NULLIF(v_material ->> 'purchase_unit', ''),
            'custom'
          );
          IF v_purchase_unit NOT IN (
            'sheet',
            'roll',
            'linear_metre',
            'square_metre',
            'unit',
            'pack',
            'custom'
          ) THEN
            v_purchase_unit := 'custom';
          END IF;
        END IF;
      END IF;

      IF v_rate IS NOT NULL AND v_rate <= 0 THEN
        v_rate := NULL;
      END IF;

      IF v_basis = 'area'
        AND v_width IS NOT NULL
        AND v_height IS NOT NULL
        AND v_quantity IS NOT NULL THEN
        v_area := public.quote_area_sqm(v_width, v_height, v_quantity);
        v_wastage := public.quote_normalize_wastage_rate(NULLIF(v_material ->> 'wastage_rate', '')::numeric);
        v_costed_area := public.quote_costed_area_sqm(v_area, v_wastage);
      END IF;

      IF v_basis = 'area' AND v_rate IS NOT NULL AND v_costed_area IS NOT NULL THEN
        v_calculated := round(v_costed_area * v_rate, 2);
        v_material_cost := v_calculated;
        v_complete := true;
      ELSIF v_basis = 'consumption' AND v_rate IS NOT NULL AND v_quantity IS NOT NULL THEN
        v_material_cost := round(v_quantity * v_rate, 2);
        v_complete := true;
      ELSIF v_basis = 'area'
        AND v_rate IS NULL
        AND v_source = 'approved_material'
        AND NOT v_use_current_rate THEN
        v_reason := 'Saved material rate is missing';
      ELSIF v_basis = 'consumption'
        AND v_rate IS NULL
        AND v_source = 'approved_material'
        AND NOT v_use_current_rate THEN
        v_reason := 'Saved material rate is missing';
      ELSIF v_basis = 'area' AND v_rate IS NULL AND v_source = 'approved_material' THEN
        v_reason := 'This price cannot be converted to a square-metre rate';
      ELSIF v_basis = 'area' THEN
        v_reason := 'Square-metre costing is incomplete';
      ELSE
        v_reason := 'Consumption quantity or rate is missing';
      END IF;
    END IF;

    IF v_locked THEN
      v_source := v_prior ->> 'source_kind';
      v_basis := v_prior ->> 'cost_basis';
      v_material_id := NULLIF(v_prior ->> 'material_id', '')::uuid;
      v_product_id := NULLIF(v_prior ->> 'material_supplier_product_id', '')::uuid;
      v_price_id := NULLIF(v_prior ->> 'material_price_id', '')::uuid;
      v_material_name := NULLIF(v_prior ->> 'material_name', '');
      v_supplier_name := NULLIF(v_prior ->> 'supplier_name', '');
      v_purchase_unit := NULLIF(v_prior ->> 'purchase_unit', '');
      v_rate := NULLIF(v_prior ->> 'snapshotted_rate', '')::numeric;
      v_snapshotted_at := NULLIF(v_prior ->> 'snapshotted_at', '')::timestamptz;
      v_area := NULL;
      v_costed_area := NULL;
      v_calculated := NULL;
      v_manual := NULL;
      v_material_cost := NULL;
      v_complete := false;
      v_reason := NULL;

      IF v_basis = 'area' THEN
        v_width := NULLIF(v_prior ->> 'finished_width_mm', '')::numeric;
        v_height := NULLIF(v_prior ->> 'finished_height_mm', '')::numeric;
      END IF;

      IF v_basis IN ('area', 'consumption') THEN
        v_quantity := NULLIF(v_prior ->> 'quantity', '')::numeric;
      END IF;

      IF v_basis = 'area' AND v_material ? 'finished_width_mm' THEN
        v_width := NULLIF(v_material ->> 'finished_width_mm', '')::numeric;
      END IF;

      IF v_basis = 'area' AND v_material ? 'finished_height_mm' THEN
        v_height := NULLIF(v_material ->> 'finished_height_mm', '')::numeric;
      END IF;

      IF v_basis IN ('area', 'consumption') AND v_material ? 'quantity' THEN
        v_quantity := NULLIF(v_material ->> 'quantity', '')::numeric;
      END IF;

      IF v_width IS NOT NULL THEN
        v_width := round(v_width, 2);
        IF v_width <= 0 THEN
          v_width := NULL;
        END IF;
      END IF;

      IF v_height IS NOT NULL THEN
        v_height := round(v_height, 2);
        IF v_height <= 0 THEN
          v_height := NULL;
        END IF;
      END IF;

      IF v_quantity IS NOT NULL THEN
        v_quantity := round(v_quantity, 4);
        IF v_quantity <= 0 THEN
          v_quantity := NULL;
        END IF;
      END IF;

      IF v_basis = 'manual' THEN
        v_material_name := coalesce(
          NULLIF(btrim(v_material ->> 'material_name'), ''),
          v_material_name
        );

        IF coalesce((v_material ->> 'confirm_manual_amount')::boolean, false)
          AND NULLIF(btrim(v_material ->> 'manual_material_cost'), '') IS NOT NULL THEN
          v_manual := round((v_material ->> 'manual_material_cost')::numeric, 2);
          IF v_manual < 0 THEN
            RAISE EXCEPTION 'Material cost cannot be negative'
              USING ERRCODE = '22023';
          END IF;
        ELSE
          v_manual := NULLIF(v_prior ->> 'manual_material_cost', '')::numeric;
        END IF;

        v_rate := NULL;
        v_width := NULL;
        v_height := NULL;
        v_quantity := NULL;

        IF v_manual IS NOT NULL THEN
          v_material_cost := v_manual;
          v_complete := true;
        ELSE
          v_reason := 'Manual material cost is missing';
        END IF;
      ELSIF v_basis = 'area'
        AND v_width IS NOT NULL
        AND v_height IS NOT NULL
        AND v_quantity IS NOT NULL
        AND v_rate IS NOT NULL THEN
        v_area := public.quote_area_sqm(v_width, v_height, v_quantity);
        v_wastage := public.quote_normalize_wastage_rate(NULLIF(v_material ->> 'wastage_rate', '')::numeric);
        v_costed_area := public.quote_costed_area_sqm(v_area, v_wastage);
        v_calculated := round(v_costed_area * v_rate, 2);
        v_material_cost := v_calculated;
        v_complete := true;
      ELSIF v_basis = 'consumption'
        AND v_quantity IS NOT NULL
        AND v_rate IS NOT NULL THEN
        v_width := NULL;
        v_height := NULL;
        v_material_cost := round(v_quantity * v_rate, 2);
        v_complete := true;
      ELSE
        v_reason := 'Saved material rate is missing';
      END IF;
    END IF;

    IF v_basis = 'area'
      AND v_width IS NOT NULL
      AND v_height IS NOT NULL
      AND v_quantity IS NOT NULL
      AND v_area IS NULL THEN
      v_area := public.quote_area_sqm(v_width, v_height, v_quantity);
        v_wastage := public.quote_normalize_wastage_rate(NULLIF(v_material ->> 'wastage_rate', '')::numeric);
        v_costed_area := public.quote_costed_area_sqm(v_area, v_wastage);
    END IF;

    IF NOT v_complete THEN
      v_all_complete := false;
      v_material_cost := NULL;
      v_calculated := NULL;
    ELSE
      v_reason := NULL;
      v_material_sum := round(v_material_sum + v_material_cost, 2);
    END IF;

    IF v_basis <> 'area' THEN
      v_width := NULL;
      v_height := NULL;
      v_area := NULL;
      v_costed_area := NULL;
    END IF;

    IF v_basis <> 'consumption' AND v_basis <> 'area' THEN
      v_quantity := NULL;
    END IF;

    IF v_basis = 'consumption' THEN
      v_calculated := NULL;
    END IF;

    IF v_basis = 'area' THEN
      v_wastage := public.quote_normalize_wastage_rate(
        coalesce(
          NULLIF(v_material ->> 'wastage_rate', '')::numeric,
          NULLIF(v_prior ->> 'wastage_rate', '')::numeric
        )
      );
    ELSE
      v_wastage := NULL;
    END IF;

    INSERT INTO public.quote_item_material_components (
      id,
      quote_item_cost_id,
      sort_order,
      source_kind,
      cost_basis,
      pricing_source,
      costing_status,
      material_id,
      material_supplier_product_id,
      material_price_id,
      material_name,
      supplier_name,
      purchase_unit,
      snapshotted_rate,
      finished_width_mm,
      finished_height_mm,
      quantity,
      inherit_dimensions,
      inherit_quantity,
      wastage_rate,
      area_sqm,
      costed_area_sqm,
      calculated_material_cost,
      manual_material_cost,
      material_cost,
      incomplete_reason,
      snapshotted_at,
      snapshotted_by
    )
    VALUES (
      coalesce(v_component_id, gen_random_uuid()),
      v_cost_id,
      v_sort,
      v_source,
      v_basis,
      CASE
        WHEN v_basis = 'manual' THEN 'manual'
        WHEN v_source = 'approved_material' THEN 'catalogue'
        ELSE 'custom'
      END,
      CASE WHEN v_complete THEN 'complete' ELSE 'incomplete' END,
      CASE WHEN v_source = 'approved_material' THEN v_material_id ELSE NULL END,
      CASE WHEN v_source = 'approved_material' THEN v_product_id ELSE NULL END,
      CASE WHEN v_source = 'approved_material' THEN v_price_id ELSE NULL END,
      v_material_name,
      v_supplier_name,
      v_purchase_unit,
      CASE WHEN v_basis = 'manual' THEN NULL ELSE v_rate END,
      v_width,
      v_height,
      v_quantity,
      v_inherit_dimensions,
      v_inherit_quantity,
      CASE WHEN v_basis = 'area' THEN v_wastage ELSE NULL END,
      v_area,
      v_costed_area,
      v_calculated,
      CASE WHEN v_basis = 'manual' THEN v_manual ELSE NULL END,
      CASE WHEN v_complete THEN v_material_cost ELSE NULL END,
      CASE WHEN v_complete THEN NULL ELSE v_reason END,
      coalesce(v_snapshotted_at, now()),
      auth.uid()
    );
  END LOOP;

  IF p_cost ? 'components' AND jsonb_typeof(p_cost -> 'components') = 'array' THEN
    FOR v_component IN
      SELECT value
      FROM jsonb_array_elements(p_cost -> 'components')
    LOOP
      v_component_sort := v_component_sort + 1;
      v_component_quantity := (v_component ->> 'quantity')::numeric;
      v_component_unit_cost := round((v_component ->> 'unit_cost')::numeric, 2);

      IF (v_component ->> 'component_type') = 'one_off'
        AND NULLIF(btrim(v_component ->> 'description'), '') IS NULL THEN
        RAISE EXCEPTION 'One-off cost needs a description'
          USING ERRCODE = '22023';
      END IF;

      IF v_component_quantity IS NULL OR v_component_quantity <= 0 THEN
        RAISE EXCEPTION 'Cost quantity must be positive'
          USING ERRCODE = '22023';
      END IF;

      IF v_component_unit_cost IS NULL OR v_component_unit_cost < 0 THEN
        RAISE EXCEPTION 'Cost unit price cannot be negative'
          USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.quote_item_cost_components (
        quote_item_cost_id,
        component_type,
        description,
        quantity,
        unit_cost,
        line_total,
        sort_order,
        supplier_reference,
        notes
      )
      VALUES (
        v_cost_id,
        v_component ->> 'component_type',
        NULLIF(btrim(v_component ->> 'description'), ''),
        v_component_quantity,
        v_component_unit_cost,
        round(v_component_quantity * v_component_unit_cost, 2),
        v_component_sort,
        NULLIF(btrim(v_component ->> 'supplier_reference'), ''),
        NULLIF(btrim(v_component ->> 'notes'), '')
      );
    END LOOP;
  END IF;

  IF v_count > 0 AND v_all_complete THEN
    UPDATE public.quote_item_costs
    SET
      costing_status = 'complete',
      material_cost = v_material_sum,
      total_estimated_cost = v_material_sum + v_additional,
      incomplete_reason = NULL
    WHERE id = v_cost_id;
  ELSIF v_count > 0 THEN
    UPDATE public.quote_item_costs
    SET
      costing_status = 'incomplete',
      material_cost = NULL,
      total_estimated_cost = NULL,
      incomplete_reason = 'One or more materials are unresolved'
    WHERE id = v_cost_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_composite_quote_line_cost(uuid, numeric, integer, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_composite_quote_line_cost(uuid, numeric, integer, jsonb, jsonb)
  TO authenticated, service_role;

