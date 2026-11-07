-- Repeat quote: new quote number, draft v1, lineage from source version.
-- Test release only until promoted. Does not modify the source quote.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_repeat_requests (
  idempotency_key uuid PRIMARY KEY,
  source_quote_id uuid NOT NULL REFERENCES public.quotes (id) ON DELETE CASCADE,
  source_quote_version_id uuid NOT NULL REFERENCES public.quote_versions (id) ON DELETE CASCADE,
  refresh_material_rates boolean NOT NULL,
  created_quote_id uuid REFERENCES public.quotes (id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_repeat_requests_source_idx
  ON public.quote_repeat_requests (source_quote_version_id, created_at DESC);

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS repeated_from_quote_id uuid REFERENCES public.quotes (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repeated_from_quote_version_id uuid REFERENCES public.quote_versions (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repeated_material_pricing text;

ALTER TABLE public.quotes
  DROP CONSTRAINT IF EXISTS quotes_repeated_material_pricing_check;

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_repeated_material_pricing_check CHECK (
    repeated_material_pricing IS NULL
    OR repeated_material_pricing IN ('refresh_catalogue', 'keep_saved')
  );

CREATE INDEX IF NOT EXISTS quotes_repeated_from_quote_idx
  ON public.quotes (repeated_from_quote_id)
  WHERE repeated_from_quote_id IS NOT NULL;

COMMENT ON COLUMN public.quotes.repeated_from_quote_id IS
  'Source quote when this record was created via Repeat quote.';

CREATE OR REPLACE FUNCTION public.allocate_next_quote_number()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(89124001);

  SELECT coalesce(max(quote_number), 0) + 1
  INTO v_next
  FROM public.quotes;

  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_repeat_refresh_material_component(p_component_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row public.quote_item_material_components%ROWTYPE;
  v_product_active boolean;
  v_material_active boolean;
  v_price_id uuid;
  v_price numeric(12, 4);
  v_price_unit text;
  v_purchase_width numeric;
  v_purchase_height numeric;
  v_purchase_length numeric;
  v_material_name text;
  v_supplier_name text;
  v_rate numeric(12, 4);
  v_area numeric(14, 6);
  v_costed_area numeric(14, 6);
  v_calculated numeric(12, 2);
  v_wastage numeric(6, 4);
  v_complete boolean := false;
  v_reason text;
BEGIN
  SELECT *
  INTO v_row
  FROM public.quote_item_material_components
  WHERE id = p_component_id
  FOR UPDATE;

  IF NOT FOUND OR v_row.source_kind IS DISTINCT FROM 'approved_material' THEN
    RETURN;
  END IF;

  IF v_row.material_supplier_product_id IS NULL THEN
    UPDATE public.quote_item_material_components
    SET
      costing_status = 'incomplete',
      calculated_material_cost = NULL,
      material_cost = NULL,
      incomplete_reason = 'Approved material product is missing'
    WHERE id = p_component_id;
    RETURN;
  END IF;

  SELECT product.active, material.active
  INTO v_product_active, v_material_active
  FROM public.material_supplier_products AS product
  JOIN public.materials AS material
    ON material.id = product.material_id
  WHERE product.id = v_row.material_supplier_product_id
    AND material.id IS NOT DISTINCT FROM v_row.material_id;

  IF NOT FOUND OR NOT coalesce(v_product_active, false) OR NOT coalesce(v_material_active, false) THEN
    UPDATE public.quote_item_material_components
    SET
      costing_status = 'incomplete',
      calculated_material_cost = NULL,
      material_cost = NULL,
      incomplete_reason = 'Supplier product or material is not active'
    WHERE id = p_component_id;
    RETURN;
  END IF;

  SELECT
    price.id,
    price.price,
    price.price_unit,
    material.purchase_width_mm,
    material.purchase_height_mm,
    material.purchase_length_mm,
    material.name,
    supplier.name
  INTO
    v_price_id,
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
  WHERE price.material_supplier_product_id = v_row.material_supplier_product_id
  ORDER BY price.effective_date DESC, price.approved_at DESC, price.created_at DESC
  LIMIT 1;

  IF NOT FOUND OR v_price IS NULL OR v_price <= 0 THEN
    UPDATE public.quote_item_material_components
    SET
      costing_status = 'incomplete',
      material_price_id = NULL,
      calculated_material_cost = NULL,
      material_cost = NULL,
      incomplete_reason = 'No current approved price for this product'
    WHERE id = p_component_id;
    RETURN;
  END IF;

  v_rate := NULL;
  v_area := v_row.area_sqm;
  v_costed_area := v_row.costed_area_sqm;
  v_wastage := coalesce(v_row.wastage_rate, 0.10);

  IF v_row.cost_basis = 'area' THEN
    v_rate := public.quote_material_rate_per_sqm(
      v_price,
      v_price_unit,
      v_purchase_width,
      v_purchase_height,
      v_purchase_length
    );

    IF v_rate IS NULL OR v_rate <= 0 THEN
      v_reason := 'This price cannot be converted to a square-metre rate';
    ELSIF v_row.finished_width_mm IS NOT NULL
      AND v_row.finished_height_mm IS NOT NULL
      AND v_row.quantity IS NOT NULL THEN
      v_area := public.quote_area_sqm(
        v_row.finished_width_mm,
        v_row.finished_height_mm,
        v_row.quantity
      );
      v_costed_area := public.quote_costed_area_sqm(v_area, v_wastage);
      v_calculated := round(v_costed_area * v_rate, 2);
      v_complete := true;
    ELSE
      v_reason := 'Square-metre costing is incomplete';
    END IF;
  ELSIF v_row.cost_basis = 'consumption' THEN
    v_rate := round(v_price, 4);

    IF v_rate <= 0 THEN
      v_reason := 'Consumption rate is missing';
    ELSIF v_row.quantity IS NOT NULL THEN
      v_calculated := round(v_row.quantity * v_rate, 2);
      v_complete := true;
    ELSE
      v_reason := 'Consumption quantity is missing';
    END IF;
  ELSE
    RETURN;
  END IF;

  IF v_complete THEN
    UPDATE public.quote_item_material_components
    SET
      material_price_id = v_price_id,
      material_name = coalesce(v_row.material_name, v_material_name),
      supplier_name = coalesce(v_row.supplier_name, v_supplier_name),
      purchase_unit = coalesce(v_price_unit, v_row.purchase_unit),
      snapshotted_rate = v_rate,
      area_sqm = v_area,
      costed_area_sqm = v_costed_area,
      calculated_material_cost = v_calculated,
      manual_material_cost = NULL,
      material_cost = v_calculated,
      costing_status = 'complete',
      incomplete_reason = NULL,
      snapshotted_at = now(),
      snapshotted_by = auth.uid()
    WHERE id = p_component_id;
  ELSE
    UPDATE public.quote_item_material_components
    SET
      material_price_id = v_price_id,
      costing_status = 'incomplete',
      calculated_material_cost = NULL,
      material_cost = NULL,
      incomplete_reason = coalesce(v_reason, 'Catalogue material could not be refreshed')
    WHERE id = p_component_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_repeat_refresh_legacy_cost(p_cost_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cost public.quote_item_costs%ROWTYPE;
  v_product_active boolean;
  v_price_id uuid;
  v_price numeric(12, 4);
  v_price_unit text;
  v_purchase_width numeric;
  v_purchase_height numeric;
  v_purchase_length numeric;
  v_rate numeric(12, 4);
  v_area numeric(14, 6);
  v_costed_area numeric(14, 6);
BEGIN
  SELECT *
  INTO v_cost
  FROM public.quote_item_costs
  WHERE id = p_cost_id
  FOR UPDATE;

  IF NOT FOUND OR v_cost.cost_kind IS DISTINCT FROM 'approved_material' THEN
    RETURN;
  END IF;

  IF v_cost.material_supplier_product_id IS NULL THEN
    UPDATE public.quote_item_costs
    SET
      costing_status = 'incomplete',
      material_cost = NULL,
      total_estimated_cost = NULL,
      incomplete_reason = 'Approved material product is missing'
    WHERE id = p_cost_id;
    RETURN;
  END IF;

  SELECT product.active
  INTO v_product_active
  FROM public.material_supplier_products AS product
  WHERE product.id = v_cost.material_supplier_product_id;

  IF NOT FOUND OR NOT coalesce(v_product_active, false) THEN
    UPDATE public.quote_item_costs
    SET
      costing_status = 'incomplete',
      material_cost = NULL,
      total_estimated_cost = NULL,
      incomplete_reason = 'Supplier product is not active'
    WHERE id = p_cost_id;
    RETURN;
  END IF;

  SELECT
    price.id,
    price.price,
    price.price_unit,
    material.purchase_width_mm,
    material.purchase_height_mm,
    material.purchase_length_mm
  INTO
    v_price_id,
    v_price,
    v_price_unit,
    v_purchase_width,
    v_purchase_height,
    v_purchase_length
  FROM public.material_prices AS price
  JOIN public.material_supplier_products AS product
    ON product.id = price.material_supplier_product_id
  JOIN public.materials AS material
    ON material.id = product.material_id
  WHERE price.material_supplier_product_id = v_cost.material_supplier_product_id
  ORDER BY price.effective_date DESC, price.approved_at DESC, price.created_at DESC
  LIMIT 1;

  IF NOT FOUND OR v_price IS NULL OR v_price <= 0 THEN
    UPDATE public.quote_item_costs
    SET
      costing_status = 'incomplete',
      material_cost = NULL,
      total_estimated_cost = NULL,
      incomplete_reason = 'No current approved price for this product'
    WHERE id = p_cost_id;
    RETURN;
  END IF;

  IF v_cost.cost_basis = 'area' THEN
    v_rate := public.quote_material_rate_per_sqm(
      v_price,
      v_price_unit,
      v_purchase_width,
      v_purchase_height,
      v_purchase_length
    );

    IF v_rate IS NULL OR v_rate <= 0 THEN
      UPDATE public.quote_item_costs
      SET
        costing_status = 'incomplete',
        material_cost = NULL,
        total_estimated_cost = NULL,
        incomplete_reason = 'This price cannot be converted to a square-metre rate'
      WHERE id = p_cost_id;
      RETURN;
    END IF;

    IF v_cost.finished_width_mm IS NOT NULL
      AND v_cost.finished_height_mm IS NOT NULL
      AND v_cost.quantity IS NOT NULL THEN
      v_area := public.quote_area_sqm(
        v_cost.finished_width_mm,
        v_cost.finished_height_mm,
        v_cost.quantity
      );
      v_costed_area := public.quote_costed_area_sqm(
        v_area,
        coalesce(v_cost.wastage_rate, 0.10)
      );

      UPDATE public.quote_item_costs
      SET
        material_price_id = v_price_id,
        rate_per_sqm = v_rate,
        area_sqm = v_area,
        costed_area_sqm = v_costed_area,
        calculated_material_cost = round(v_costed_area * v_rate, 2),
        material_cost = round(v_costed_area * v_rate, 2),
        total_estimated_cost = round(v_costed_area * v_rate, 2) + coalesce(additional_cost, 0),
        costing_status = 'complete',
        incomplete_reason = NULL,
        snapshotted_at = now(),
        snapshotted_by = auth.uid()
      WHERE id = p_cost_id;
    ELSE
      UPDATE public.quote_item_costs
      SET
        costing_status = 'incomplete',
        material_cost = NULL,
        total_estimated_cost = NULL,
        incomplete_reason = 'Square-metre costing is incomplete'
      WHERE id = p_cost_id;
    END IF;
  ELSE
    UPDATE public.quote_item_costs
    SET
      material_price_id = v_price_id,
      costing_status = 'incomplete',
      incomplete_reason = 'Legacy non-area material refresh is not supported'
    WHERE id = p_cost_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_repeat_sync_composite_cost_summary(p_cost_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_additional numeric(12, 2) := 0;
  v_material_count integer := 0;
  v_incomplete integer := 0;
  v_material_sum numeric(12, 2) := 0;
BEGIN
  SELECT cost_kind, coalesce(additional_cost, 0)
  INTO v_kind, v_additional
  FROM public.quote_item_costs
  WHERE id = p_cost_id;

  IF NOT FOUND OR v_kind IS DISTINCT FROM 'composite' THEN
    RETURN;
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE component.costing_status = 'incomplete')::integer,
    coalesce(round(sum(component.material_cost) FILTER (
      WHERE component.costing_status = 'complete'
    ), 2), 0)
  INTO v_material_count, v_incomplete, v_material_sum
  FROM public.quote_item_material_components AS component
  WHERE component.quote_item_cost_id = p_cost_id;

  IF v_material_count = 0 OR v_incomplete > 0 THEN
    UPDATE public.quote_item_costs
    SET
      costing_status = 'incomplete',
      material_cost = NULL,
      total_estimated_cost = NULL,
      incomplete_reason = 'One or more materials are unresolved'
    WHERE id = p_cost_id;
  ELSE
    UPDATE public.quote_item_costs
    SET
      costing_status = 'complete',
      material_cost = v_material_sum,
      total_estimated_cost = v_material_sum + v_additional,
      incomplete_reason = NULL
    WHERE id = p_cost_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.repeat_quote(
  p_source_version_id uuid,
  p_refresh_material_rates boolean,
  p_idempotency_key uuid,
  p_expiry_date date
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_source_version public.quote_versions%ROWTYPE;
  v_source_quote public.quotes%ROWTYPE;
  v_new_quote_id uuid;
  v_new_version_id uuid;
  v_next_number integer;
  v_old_item public.quote_items%ROWTYPE;
  v_new_item_id uuid;
  v_old_cost public.quote_item_costs%ROWTYPE;
  v_new_cost_id uuid;
  v_company_active boolean;
  v_contact_active boolean;
  v_has_materials boolean;
  v_component_id uuid;
  v_cost_id uuid;
BEGIN
  IF NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Admin access required'
      USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT created_quote_id
  INTO v_existing
  FROM public.quote_repeat_requests
  WHERE idempotency_key = p_idempotency_key
    AND created_quote_id IS NOT NULL;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT *
  INTO v_source_version
  FROM public.quote_versions
  WHERE id = p_source_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote version not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_source_quote
  FROM public.quotes
  WHERE id = v_source_version.quote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_source_quote.company_id IS NULL OR v_source_quote.contact_id IS NULL THEN
    RAISE EXCEPTION 'Quote must have an active company and contact before it can be repeated'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(is_active, false)
  INTO v_company_active
  FROM public.companies
  WHERE id = v_source_quote.company_id;

  IF NOT coalesce(v_company_active, false) THEN
    RAISE EXCEPTION 'Company must be active before this quote can be repeated'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(is_active, false)
  INTO v_contact_active
  FROM public.contacts
  WHERE id = v_source_quote.contact_id
    AND company_id = v_source_quote.company_id;

  IF NOT coalesce(v_contact_active, false) THEN
    RAISE EXCEPTION 'Contact must be active and belong to this company before this quote can be repeated'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.quote_repeat_requests (
    idempotency_key,
    source_quote_id,
    source_quote_version_id,
    refresh_material_rates,
    created_by
  )
  VALUES (
    p_idempotency_key,
    v_source_quote.id,
    v_source_version.id,
    p_refresh_material_rates,
    auth.uid()
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT created_quote_id
  INTO v_existing
  FROM public.quote_repeat_requests
  WHERE idempotency_key = p_idempotency_key
    AND created_quote_id IS NOT NULL;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_next_number := public.allocate_next_quote_number();

  INSERT INTO public.quotes (
    quote_number,
    company_id,
    contact_id,
    quote_request_id,
    opportunity_id,
    project_name,
    required_date,
    status,
    current_version,
    created_by,
    repeated_from_quote_id,
    repeated_from_quote_version_id,
    repeated_material_pricing
  )
  VALUES (
    v_next_number,
    v_source_quote.company_id,
    v_source_quote.contact_id,
    NULL,
    NULL,
    v_source_quote.project_name,
    NULL,
    'draft',
    1,
    auth.uid(),
    v_source_quote.id,
    v_source_version.id,
    CASE
      WHEN p_refresh_material_rates THEN 'refresh_catalogue'
      ELSE 'keep_saved'
    END
  )
  RETURNING id INTO v_new_quote_id;

  INSERT INTO public.quote_versions (
    quote_id,
    version_number,
    version_status,
    introduction,
    customer_notes,
    internal_notes,
    expiry_date,
    payment_terms_days,
    subtotal,
    vat_rate,
    vat_amount,
    total,
    sent_at,
    accepted_at,
    declined_at
  )
  VALUES (
    v_new_quote_id,
    1,
    'draft',
    v_source_version.introduction,
    v_source_version.customer_notes,
    v_source_version.internal_notes,
    p_expiry_date,
    v_source_version.payment_terms_days,
    v_source_version.subtotal,
    v_source_version.vat_rate,
    v_source_version.vat_amount,
    v_source_version.total,
    NULL,
    NULL,
    NULL
  )
  RETURNING id INTO v_new_version_id;

  FOR v_old_item IN
    SELECT *
    FROM public.quote_items
    WHERE quote_version_id = p_source_version_id
    ORDER BY sort_order, created_at
  LOOP
    INSERT INTO public.quote_items (
      quote_version_id,
      sort_order,
      title,
      description,
      quantity,
      unit_price,
      line_total,
      is_optional,
      is_selected,
      image_storage_path,
      image_file_name,
      image_file_type,
      image_file_size
    )
    VALUES (
      v_new_version_id,
      v_old_item.sort_order,
      v_old_item.title,
      v_old_item.description,
      v_old_item.quantity,
      v_old_item.unit_price,
      v_old_item.line_total,
      v_old_item.is_optional,
      v_old_item.is_selected,
      v_old_item.image_storage_path,
      v_old_item.image_file_name,
      v_old_item.image_file_type,
      v_old_item.image_file_size
    )
    RETURNING id INTO v_new_item_id;

    SELECT *
    INTO v_old_cost
    FROM public.quote_item_costs
    WHERE quote_item_id = v_old_item.id;

    IF NOT FOUND THEN
      CONTINUE;
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
      snapshotted_at,
      snapshotted_by,
      default_finished_width_mm,
      default_finished_height_mm
    )
    VALUES (
      v_new_item_id,
      v_old_cost.cost_kind,
      v_old_cost.cost_basis,
      v_old_cost.costing_status,
      v_old_cost.material_id,
      v_old_cost.material_supplier_product_id,
      v_old_cost.material_price_id,
      v_old_cost.material_name,
      v_old_cost.supplier_name,
      v_old_cost.rate_per_sqm,
      v_old_cost.finished_width_mm,
      v_old_cost.finished_height_mm,
      v_old_cost.quantity,
      v_old_cost.wastage_rate,
      v_old_cost.area_sqm,
      v_old_cost.costed_area_sqm,
      v_old_cost.calculated_material_cost,
      v_old_cost.manual_material_cost,
      v_old_cost.material_cost,
      v_old_cost.additional_cost,
      v_old_cost.total_estimated_cost,
      v_old_cost.incomplete_reason,
      v_old_cost.snapshotted_at,
      v_old_cost.snapshotted_by,
      v_old_cost.default_finished_width_mm,
      v_old_cost.default_finished_height_mm
    )
    RETURNING id INTO v_new_cost_id;

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
    SELECT
      v_new_cost_id,
      component.component_type,
      component.description,
      component.quantity,
      component.unit_cost,
      component.line_total,
      component.sort_order,
      component.supplier_reference,
      component.notes
    FROM public.quote_item_cost_components AS component
    WHERE component.quote_item_cost_id = v_old_cost.id;

    INSERT INTO public.quote_item_material_components (
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
    SELECT
      v_new_cost_id,
      component.sort_order,
      component.source_kind,
      component.cost_basis,
      component.pricing_source,
      component.costing_status,
      component.material_id,
      component.material_supplier_product_id,
      component.material_price_id,
      component.material_name,
      component.supplier_name,
      component.purchase_unit,
      component.snapshotted_rate,
      component.finished_width_mm,
      component.finished_height_mm,
      component.quantity,
      component.inherit_dimensions,
      component.inherit_quantity,
      component.wastage_rate,
      component.area_sqm,
      component.costed_area_sqm,
      component.calculated_material_cost,
      component.manual_material_cost,
      component.material_cost,
      component.incomplete_reason,
      component.snapshotted_at,
      component.snapshotted_by
    FROM public.quote_item_material_components AS component
    WHERE component.quote_item_cost_id = v_old_cost.id;
  END LOOP;

  IF p_refresh_material_rates THEN
    FOR v_component_id IN
      SELECT mc.id
      FROM public.quote_item_material_components AS mc
      JOIN public.quote_item_costs AS cost
        ON cost.id = mc.quote_item_cost_id
      JOIN public.quote_items AS item
        ON item.id = cost.quote_item_id
      WHERE item.quote_version_id = v_new_version_id
        AND mc.source_kind = 'approved_material'
        AND mc.pricing_source = 'catalogue'
    LOOP
      PERFORM public.quote_repeat_refresh_material_component(v_component_id);
    END LOOP;

    FOR v_cost_id IN
      SELECT cost.id
      FROM public.quote_item_costs AS cost
      JOIN public.quote_items AS item
        ON item.id = cost.quote_item_id
      WHERE item.quote_version_id = v_new_version_id
        AND cost.cost_kind = 'approved_material'
        AND cost.cost_basis = 'area'
        AND NOT EXISTS (
          SELECT 1
          FROM public.quote_item_material_components AS mc
          WHERE mc.quote_item_cost_id = cost.id
        )
    LOOP
      PERFORM public.quote_repeat_refresh_legacy_cost(v_cost_id);
    END LOOP;

    FOR v_cost_id IN
      SELECT cost.id
      FROM public.quote_item_costs AS cost
      JOIN public.quote_items AS item
        ON item.id = cost.quote_item_id
      WHERE item.quote_version_id = v_new_version_id
        AND cost.cost_kind = 'composite'
    LOOP
      PERFORM public.quote_repeat_sync_composite_cost_summary(v_cost_id);
    END LOOP;
  END IF;

  UPDATE public.quote_repeat_requests
  SET created_quote_id = v_new_quote_id
  WHERE idempotency_key = p_idempotency_key;

  RETURN v_new_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_next_quote_number() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.repeat_quote(uuid, boolean, uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quote_repeat_refresh_material_component(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quote_repeat_refresh_legacy_cost(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quote_repeat_sync_composite_cost_summary(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.allocate_next_quote_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.repeat_quote(uuid, boolean, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_repeat_refresh_material_component(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_repeat_refresh_legacy_cost(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_repeat_sync_composite_cost_summary(uuid) TO authenticated;

ALTER TABLE public.quote_repeat_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_repeat_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_repeat_requests_admin ON public.quote_repeat_requests;
CREATE POLICY quote_repeat_requests_admin
  ON public.quote_repeat_requests
  FOR ALL
  TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

COMMIT;
