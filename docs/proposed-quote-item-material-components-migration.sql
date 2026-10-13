-- Proposed multi-material quote costing. DO NOT APPLY until explicitly approved.
-- Apply manually in Supabase, once, after approval. Do not run from the app.
-- Do not edit or re-run the quote costing migration that is already in production.
--
-- Inspected read-only on 13 Oct 2026 before this file was written:
--   quote_item_costs: 0 rows
--   quote_item_cost_components: 0 rows
--   quotes: 7
--   quote_items: 14
-- The new checks also accept the existing single-material and service rows,
-- so a cost row created after that count does not need to be rewritten.
--
-- Adds one material component table and two summary columns.
-- Extends the two existing save functions so one transaction stores the sell
-- lines, every material component, every production cost and the line summary.
-- A payload without a materials array keeps the current single-material save.
-- That older path still prices an approved material from the supplied price
-- row and the material's current purchase dimensions.
-- A materials array keeps the snapshot stored for that component id.
-- Line position and component position are not identities. Reordering,
-- inserting or deleting a quote line or material cannot move a stored rate,
-- supplier or catalogue identity onto a different material. Each component
-- id can be used once in a save. A new material is sent with intent add and
-- receives a new id. A client rate, supplier or catalogue id is not trusted
-- on re-save.
-- A manual component may be renamed. Its stored amount stays unless
-- confirm_manual_amount is sent with the new amount.
-- Omitted dimensions and quantity stay stored. A present width, height or
-- quantity is costed at the stored rate. use_current_rate true is the only
-- request that reads the current purchase dimensions or the amount on the
-- supplied price row. A newer price row is never chosen automatically.
-- A manual amount is stored as pricing_source manual and never as a
-- catalogue rate.
-- A single-material cost row is included in that snapshot, so opening it in
-- the multi-material editor does not drop its saved rate.
-- A line whose payload omits cost, or sends JSON null, keeps the internal
-- cost snapshot already stored for that quote line id. cost.clear true is
-- the only request that removes it. Changing the sell line without a cost
-- payload therefore cannot delete the snapshot.
--
-- Does not add columns to quotes, quote_versions or quote_items.
-- Does not insert, update or delete materials, supplier products, material
-- prices, supplier invoices, preferred suppliers, or discovery data.
-- Does not create or replace a quote deletion function.

BEGIN;

-- ---------------------------------------------------------------------------
-- Line summary accepts a composite row. Existing kinds stay valid.
-- A composite row stores the line default size and the summed costs.
-- It does not store one material identity, one rate or one area.
-- ---------------------------------------------------------------------------

ALTER TABLE public.quote_item_costs
  ADD COLUMN IF NOT EXISTS default_finished_width_mm numeric(12, 2),
  ADD COLUMN IF NOT EXISTS default_finished_height_mm numeric(12, 2);

ALTER TABLE public.quote_item_costs
  DROP CONSTRAINT IF EXISTS quote_item_costs_kind_check;

ALTER TABLE public.quote_item_costs
  ADD CONSTRAINT quote_item_costs_kind_check CHECK (
    cost_kind IN (
      'approved_material',
      'custom_material',
      'service',
      'composite'
    )
  );

ALTER TABLE public.quote_item_costs
  DROP CONSTRAINT IF EXISTS quote_item_costs_basis_check;

ALTER TABLE public.quote_item_costs
  ADD CONSTRAINT quote_item_costs_basis_check CHECK (
    cost_basis IN ('area', 'manual', 'composite')
  );

ALTER TABLE public.quote_item_costs
  DROP CONSTRAINT IF EXISTS quote_item_costs_composite_pair;

ALTER TABLE public.quote_item_costs
  ADD CONSTRAINT quote_item_costs_composite_pair CHECK (
    (cost_kind = 'composite') = (cost_basis = 'composite')
  );

ALTER TABLE public.quote_item_costs
  DROP CONSTRAINT IF EXISTS quote_item_costs_composite_shape;

ALTER TABLE public.quote_item_costs
  ADD CONSTRAINT quote_item_costs_composite_shape CHECK (
    cost_kind <> 'composite'
    OR (
      material_id IS NULL
      AND material_supplier_product_id IS NULL
      AND material_price_id IS NULL
      AND material_name IS NULL
      AND supplier_name IS NULL
      AND rate_per_sqm IS NULL
      AND finished_width_mm IS NULL
      AND finished_height_mm IS NULL
      AND quantity IS NULL
      AND wastage_rate IS NULL
      AND area_sqm IS NULL
      AND costed_area_sqm IS NULL
      AND calculated_material_cost IS NULL
      AND manual_material_cost IS NULL
    )
  );

ALTER TABLE public.quote_item_costs
  DROP CONSTRAINT IF EXISTS quote_item_costs_default_width_positive;

ALTER TABLE public.quote_item_costs
  ADD CONSTRAINT quote_item_costs_default_width_positive CHECK (
    default_finished_width_mm IS NULL OR default_finished_width_mm > 0
  );

ALTER TABLE public.quote_item_costs
  DROP CONSTRAINT IF EXISTS quote_item_costs_default_height_positive;

ALTER TABLE public.quote_item_costs
  ADD CONSTRAINT quote_item_costs_default_height_positive CHECK (
    default_finished_height_mm IS NULL OR default_finished_height_mm > 0
  );

-- ---------------------------------------------------------------------------
-- Many approved materials, custom materials, or a mixture on one quote line.
-- Production costs stay on quote_item_cost_components. The same production
-- category can already be used more than once, so that table is unchanged.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.quote_item_material_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_item_cost_id uuid NOT NULL
    REFERENCES public.quote_item_costs (id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  source_kind text NOT NULL,
  cost_basis text NOT NULL,
  pricing_source text NOT NULL,
  costing_status text NOT NULL,
  material_id uuid
    REFERENCES public.materials (id) ON DELETE RESTRICT,
  material_supplier_product_id uuid
    REFERENCES public.material_supplier_products (id) ON DELETE RESTRICT,
  material_price_id uuid
    REFERENCES public.material_prices (id) ON DELETE RESTRICT,
  material_name text,
  supplier_name text,
  purchase_unit text,
  snapshotted_rate numeric(12, 4),
  finished_width_mm numeric(12, 2),
  finished_height_mm numeric(12, 2),
  quantity numeric(12, 4),
  inherit_dimensions boolean NOT NULL DEFAULT true,
  inherit_quantity boolean NOT NULL DEFAULT true,
  wastage_rate numeric(6, 4),
  area_sqm numeric(14, 6),
  costed_area_sqm numeric(14, 6),
  calculated_material_cost numeric(12, 2),
  manual_material_cost numeric(12, 2),
  material_cost numeric(12, 2),
  incomplete_reason text,
  snapshotted_at timestamptz NOT NULL DEFAULT now(),
  snapshotted_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_item_material_components_source_check CHECK (
    source_kind IN ('approved_material', 'custom_material')
  ),
  CONSTRAINT quote_item_material_components_basis_check CHECK (
    cost_basis IN ('area', 'consumption', 'manual')
  ),
  CONSTRAINT quote_item_material_components_status_check CHECK (
    costing_status IN ('complete', 'incomplete')
  ),
  CONSTRAINT quote_item_material_components_pricing_source_check CHECK (
    pricing_source IN ('catalogue', 'manual', 'custom')
  ),
  CONSTRAINT quote_item_material_components_catalogue_source_check CHECK (
    pricing_source <> 'catalogue'
    OR (
      source_kind = 'approved_material'
      AND cost_basis IN ('area', 'consumption')
      AND manual_material_cost IS NULL
      AND (
        costing_status = 'incomplete'
        OR snapshotted_rate IS NOT NULL
      )
    )
  ),
  CONSTRAINT quote_item_material_components_manual_source_check CHECK (
    pricing_source <> 'manual'
    OR (
      cost_basis = 'manual'
      AND snapshotted_rate IS NULL
      AND calculated_material_cost IS NULL
      AND area_sqm IS NULL
      AND costed_area_sqm IS NULL
      AND wastage_rate IS NULL
    )
  ),
  CONSTRAINT quote_item_material_components_custom_source_check CHECK (
    pricing_source <> 'custom'
    OR (
      source_kind = 'custom_material'
      AND cost_basis IN ('area', 'consumption')
      AND material_id IS NULL
      AND material_supplier_product_id IS NULL
      AND material_price_id IS NULL
      AND manual_material_cost IS NULL
    )
  ),
  CONSTRAINT quote_item_material_components_custom_has_no_catalog_link CHECK (
    source_kind <> 'custom_material'
    OR (
      material_id IS NULL
      AND material_supplier_product_id IS NULL
      AND material_price_id IS NULL
    )
  ),
  CONSTRAINT quote_item_material_components_approved_calculated_provenance CHECK (
    costing_status <> 'complete'
    OR source_kind <> 'approved_material'
    OR cost_basis = 'manual'
    OR (
      material_id IS NOT NULL
      AND material_supplier_product_id IS NOT NULL
      AND material_price_id IS NOT NULL
    )
  ),
  CONSTRAINT quote_item_material_components_purchase_unit_check CHECK (
    purchase_unit IS NULL
    OR purchase_unit IN (
      'sheet',
      'roll',
      'linear_metre',
      'square_metre',
      'unit',
      'pack',
      'custom'
    )
  ),
  CONSTRAINT quote_item_material_components_rate_positive CHECK (
    snapshotted_rate IS NULL OR snapshotted_rate > 0
  ),
  CONSTRAINT quote_item_material_components_width_positive CHECK (
    finished_width_mm IS NULL OR finished_width_mm > 0
  ),
  CONSTRAINT quote_item_material_components_height_positive CHECK (
    finished_height_mm IS NULL OR finished_height_mm > 0
  ),
  CONSTRAINT quote_item_material_components_quantity_positive CHECK (
    quantity IS NULL OR quantity > 0
  ),
  CONSTRAINT quote_item_material_components_wastage_fixed CHECK (
    wastage_rate IS NULL OR wastage_rate = 0.10
  ),
  CONSTRAINT quote_item_material_components_area_shape CHECK (
    cost_basis <> 'area'
    OR (
      wastage_rate = 0.10
      AND manual_material_cost IS NULL
      AND (
        finished_width_mm IS NULL
        OR finished_height_mm IS NULL
        OR quantity IS NULL
        OR (
          area_sqm = public.quote_area_sqm(
            finished_width_mm,
            finished_height_mm,
            quantity
          )
          AND costed_area_sqm = public.quote_costed_area_sqm(area_sqm)
          AND (
            calculated_material_cost IS NULL
            OR (
              snapshotted_rate IS NOT NULL
              AND calculated_material_cost = round(costed_area_sqm * snapshotted_rate, 2)
              AND material_cost = calculated_material_cost
            )
          )
        )
      )
    )
  ),
  CONSTRAINT quote_item_material_components_consumption_shape CHECK (
    cost_basis <> 'consumption'
    OR (
      wastage_rate IS NULL
      AND area_sqm IS NULL
      AND costed_area_sqm IS NULL
      AND finished_width_mm IS NULL
      AND finished_height_mm IS NULL
      AND calculated_material_cost IS NULL
      AND manual_material_cost IS NULL
      AND (
        material_cost IS NULL
        OR (
          quantity IS NOT NULL
          AND snapshotted_rate IS NOT NULL
          AND material_cost = round(quantity * snapshotted_rate, 2)
        )
      )
    )
  ),
  CONSTRAINT quote_item_material_components_manual_shape CHECK (
    cost_basis <> 'manual'
    OR (
      snapshotted_rate IS NULL
      AND wastage_rate IS NULL
      AND area_sqm IS NULL
      AND costed_area_sqm IS NULL
      AND finished_width_mm IS NULL
      AND finished_height_mm IS NULL
      AND quantity IS NULL
      AND calculated_material_cost IS NULL
      AND (
        material_cost IS NULL
        OR material_cost = manual_material_cost
      )
    )
  ),
  CONSTRAINT quote_item_material_components_complete_area CHECK (
    costing_status <> 'complete'
    OR cost_basis <> 'area'
    OR (
      snapshotted_rate IS NOT NULL
      AND finished_width_mm IS NOT NULL
      AND finished_height_mm IS NOT NULL
      AND quantity IS NOT NULL
      AND area_sqm IS NOT NULL
      AND costed_area_sqm IS NOT NULL
      AND calculated_material_cost IS NOT NULL
      AND material_cost = calculated_material_cost
    )
  ),
  CONSTRAINT quote_item_material_components_complete_consumption CHECK (
    costing_status <> 'complete'
    OR cost_basis <> 'consumption'
    OR (
      quantity IS NOT NULL
      AND snapshotted_rate IS NOT NULL
      AND material_cost IS NOT NULL
    )
  ),
  CONSTRAINT quote_item_material_components_complete_manual CHECK (
    costing_status <> 'complete'
    OR cost_basis <> 'manual'
    OR (
      manual_material_cost IS NOT NULL
      AND material_cost = manual_material_cost
    )
  ),
  CONSTRAINT quote_item_material_components_unresolved_is_not_zero CHECK (
    costing_status <> 'incomplete'
    OR material_cost IS NULL
  ),
  CONSTRAINT quote_item_material_components_money_non_negative CHECK (
    (calculated_material_cost IS NULL OR calculated_material_cost >= 0)
    AND (manual_material_cost IS NULL OR manual_material_cost >= 0)
    AND (material_cost IS NULL OR material_cost >= 0)
  ),
  CONSTRAINT quote_item_material_components_name_length CHECK (
    material_name IS NULL OR char_length(material_name) <= 200
  ),
  CONSTRAINT quote_item_material_components_supplier_length CHECK (
    supplier_name IS NULL OR char_length(supplier_name) <= 200
  ),
  CONSTRAINT quote_item_material_components_reason_length CHECK (
    incomplete_reason IS NULL OR char_length(incomplete_reason) <= 200
  ),
  CONSTRAINT quote_item_material_components_sort_positive CHECK (
    sort_order > 0
  ),
  CONSTRAINT quote_item_material_components_sort_unique UNIQUE (
    quote_item_cost_id,
    sort_order
  )
);

CREATE INDEX IF NOT EXISTS quote_item_material_components_cost_idx
  ON public.quote_item_material_components (quote_item_cost_id, sort_order);

CREATE INDEX IF NOT EXISTS quote_item_material_components_material_idx
  ON public.quote_item_material_components (material_id);

CREATE INDEX IF NOT EXISTS quote_item_material_components_price_idx
  ON public.quote_item_material_components (material_price_id);

DROP TRIGGER IF EXISTS quote_item_material_components_set_updated_at
  ON public.quote_item_material_components;
CREATE TRIGGER quote_item_material_components_set_updated_at
  BEFORE UPDATE ON public.quote_item_material_components
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP TRIGGER IF EXISTS quote_item_material_components_draft_only
  ON public.quote_item_material_components;
CREATE TRIGGER quote_item_material_components_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.quote_item_material_components
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_quote_cost_component_draft_only();

-- ---------------------------------------------------------------------------
-- A composite summary is complete only when every material component is
-- complete. An unresolved component keeps the line material cost null.
-- It is not stored as a partial sum and it is not stored as zero.
-- A line with no material components is also unresolved.
-- An explicit manual component of zero remains a real zero.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_quote_material_cost_sum()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost_id uuid;
  v_kind text;
  v_status text;
  v_material_cost numeric(12, 2);
  v_total numeric(12, 2);
  v_count integer;
  v_incomplete integer;
  v_sum numeric(12, 2);
BEGIN
  IF TG_TABLE_NAME = 'quote_item_costs' THEN
    IF TG_OP = 'DELETE' THEN
      v_cost_id := OLD.id;
    ELSE
      v_cost_id := NEW.id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_cost_id := OLD.quote_item_cost_id;
  ELSE
    v_cost_id := NEW.quote_item_cost_id;
  END IF;

  SELECT
    cost.cost_kind,
    cost.costing_status,
    cost.material_cost,
    cost.total_estimated_cost
  INTO v_kind, v_status, v_material_cost, v_total
  FROM public.quote_item_costs AS cost
  WHERE cost.id = v_cost_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE component.costing_status = 'incomplete')::integer,
    coalesce(round(sum(component.material_cost) FILTER (
      WHERE component.costing_status = 'complete'
    ), 2), 0)
  INTO v_count, v_incomplete, v_sum
  FROM public.quote_item_material_components AS component
  WHERE component.quote_item_cost_id = v_cost_id;

  IF v_kind IS DISTINCT FROM 'composite' THEN
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Material components require a composite cost summary'
        USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
  END IF;

  IF v_incomplete > 0 OR v_count = 0 THEN
    IF v_status IS DISTINCT FROM 'incomplete'
      OR v_material_cost IS NOT NULL
      OR v_total IS NOT NULL THEN
      RAISE EXCEPTION 'Unresolved material components cannot produce a confirmed cost'
        USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
  END IF;

  IF v_status IS DISTINCT FROM 'complete'
    OR v_material_cost IS DISTINCT FROM v_sum
    OR v_total IS NULL THEN
    RAISE EXCEPTION 'Material cost does not match its components'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS quote_item_costs_material_sum ON public.quote_item_costs;
CREATE CONSTRAINT TRIGGER quote_item_costs_material_sum
  AFTER INSERT OR UPDATE ON public.quote_item_costs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_quote_material_cost_sum();

DROP TRIGGER IF EXISTS quote_item_material_components_sum
  ON public.quote_item_material_components;
CREATE CONSTRAINT TRIGGER quote_item_material_components_sum
  AFTER INSERT OR UPDATE OR DELETE ON public.quote_item_material_components
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_quote_material_cost_sum();

-- ---------------------------------------------------------------------------
-- Access matches the existing cost tables. Approved admin and super_admin
-- only. Customers, sales, production and accounts have no policy.
-- ---------------------------------------------------------------------------

ALTER TABLE public.quote_item_material_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_item_material_components FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_item_material_components_select_admin
  ON public.quote_item_material_components;
CREATE POLICY quote_item_material_components_select_admin
  ON public.quote_item_material_components FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS quote_item_material_components_insert_admin
  ON public.quote_item_material_components;
CREATE POLICY quote_item_material_components_insert_admin
  ON public.quote_item_material_components FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS quote_item_material_components_update_admin
  ON public.quote_item_material_components;
CREATE POLICY quote_item_material_components_update_admin
  ON public.quote_item_material_components FOR UPDATE TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS quote_item_material_components_delete_admin
  ON public.quote_item_material_components;
CREATE POLICY quote_item_material_components_delete_admin
  ON public.quote_item_material_components FOR DELETE TO authenticated
  USING (public.is_approved_candid_admin());

REVOKE ALL ON TABLE public.quote_item_material_components FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.quote_item_material_components TO authenticated;

REVOKE ALL ON FUNCTION public.enforce_quote_material_cost_sum() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_quote_material_cost_sum()
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Composite save used by replace_draft_quote_lines when a line sends a
-- materials array. Existing components for this draft are supplied by the
-- caller from the rows read before the line replacement. A stored component
-- is recognised only by its id. Position is not consulted. Unless
-- use_current_rate is true, the stored rate, catalogue ids, catalogue
-- material name, supplier name, purchase unit and snapshot time are kept.
-- A missing or altered client value for any of those fields cannot replace
-- them. A manual component keeps its stored amount unless
-- confirm_manual_amount is true. A non-blank manual name replaces the
-- stored label. A blank manual name leaves the stored label in place.
-- Omitted dimensions and quantity stay as stored. A width, height or
-- quantity key that is present is a job edit and is costed at the stored
-- rate. use_current_rate true reads only the supplied price row and the
-- material's current purchase dimensions. A newer price row is never
-- selected. A manual amount is pricing_source manual, with no catalogue
-- rate. confirm_manual_amount true is the only way to change a stored
-- manual amount.
-- Area wastage is always 10 percent. Unit and pack prices are not converted
-- to square metres. No coverage quantity is invented from ink volume.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.save_composite_quote_line_cost(uuid, numeric, jsonb);

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
        v_costed_area := public.quote_costed_area_sqm(v_area);
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
        v_costed_area := public.quote_costed_area_sqm(v_area);
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
      v_costed_area := public.quote_costed_area_sqm(v_area);
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
      CASE WHEN v_basis = 'area' THEN 0.10 ELSE NULL END,
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

      INSERT INTO public.quote_item_cost_components (
        quote_item_cost_id,
        component_type,
        description,
        quantity,
        unit_cost,
        line_total,
        sort_order
      )
      VALUES (
        v_cost_id,
        v_component ->> 'component_type',
        NULLIF(btrim(v_component ->> 'description'), ''),
        v_component_quantity,
        v_component_unit_cost,
        round(v_component_quantity * v_component_unit_cost, 2),
        v_component_sort
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

-- ---------------------------------------------------------------------------
-- Existing atomic save. The single-material payload is unchanged.
-- A materials array is saved in the same transaction as the sell lines.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.replace_draft_quote_lines(
  p_quote_version_id uuid,
  p_version jsonb,
  p_lines jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_vat_rate numeric;
  v_line jsonb;
  v_cost jsonb;
  v_component jsonb;
  v_item_id uuid;
  v_cost_id uuid;
  v_sort integer := 0;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_subtotal numeric(12, 2) := 0;
  v_existing_materials jsonb := '[]'::jsonb;
  v_component_sort integer;
  v_component_quantity numeric;
  v_component_unit_cost numeric;
  v_additional numeric(12, 2);
  v_rate numeric(12, 4);
  v_width numeric(12, 2);
  v_height numeric(12, 2);
  v_area numeric(14, 6);
  v_costed_area numeric(14, 6);
  v_material_cost numeric(12, 2);
  v_manual numeric(12, 2);
  v_basis text;
  v_kind text;
  v_complete boolean;
  v_material_id uuid;
  v_product_id uuid;
  v_price_id uuid;
  v_price numeric;
  v_price_unit text;
  v_purchase_width numeric;
  v_purchase_height numeric;
  v_purchase_length numeric;
  v_material_name text;
  v_supplier_name text;
  v_reason text;
  v_known_item_ids uuid[] := ARRAY[]::uuid[];
  v_claimed_item_ids uuid[] := ARRAY[]::uuid[];
  v_requested_item_id uuid;
  v_preserved_costs jsonb := '[]'::jsonb;
  v_preserved jsonb;
BEGIN
  IF NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Admin access required'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Quote lines must be a list'
      USING ERRCODE = '22023';
  END IF;

  SELECT quote_version.version_status
  INTO v_status
  FROM public.quote_versions AS quote_version
  WHERE quote_version.id = p_quote_version_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Quote version not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Quote costs can only change on a draft version'
      USING ERRCODE = '42501';
  END IF;

  v_vat_rate := (p_version ->> 'vat_rate')::numeric;

  IF v_vat_rate IS NULL OR v_vat_rate < 0 OR v_vat_rate > 1 THEN
    RAISE EXCEPTION 'VAT rate must be a fraction from 0 to 1'
      USING ERRCODE = '22023';
  END IF;

  IF (p_version ->> 'payment_terms_days')::integer < 0
    OR (p_version ->> 'payment_terms_days')::integer > 365 THEN
    RAISE EXCEPTION 'Payment terms must be between 0 and 365 days'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', snapshot.id,
    'source_kind', snapshot.source_kind,
    'cost_basis', snapshot.cost_basis,
    'material_id', snapshot.material_id,
    'material_supplier_product_id', snapshot.material_supplier_product_id,
    'material_price_id', snapshot.material_price_id,
    'material_name', snapshot.material_name,
    'supplier_name', snapshot.supplier_name,
    'purchase_unit', snapshot.purchase_unit,
    'snapshotted_rate', snapshot.snapshotted_rate,
    'finished_width_mm', snapshot.finished_width_mm,
    'finished_height_mm', snapshot.finished_height_mm,
    'quantity', snapshot.quantity,
    'manual_material_cost', snapshot.manual_material_cost,
    'snapshotted_at', snapshot.snapshotted_at
  )), '[]'::jsonb)
  INTO v_existing_materials
  FROM (
    SELECT
      component.id,
      component.source_kind,
      component.cost_basis,
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
      component.manual_material_cost,
      component.snapshotted_at
    FROM public.quote_item_material_components AS component
    JOIN public.quote_item_costs AS cost
      ON cost.id = component.quote_item_cost_id
    JOIN public.quote_items AS item
      ON item.id = cost.quote_item_id
    WHERE item.quote_version_id = p_quote_version_id

    UNION ALL

    SELECT
      cost.id,
      CASE
        WHEN cost.cost_kind = 'service' THEN 'custom_material'
        ELSE cost.cost_kind
      END,
      CASE
        WHEN cost.cost_kind = 'service' THEN 'manual'
        ELSE cost.cost_basis
      END,
      cost.material_id,
      cost.material_supplier_product_id,
      cost.material_price_id,
      coalesce(
        cost.material_name,
        CASE WHEN cost.cost_kind = 'service' THEN 'Service' ELSE NULL END
      ),
      cost.supplier_name,
      CASE WHEN cost.cost_basis = 'area' THEN 'square_metre' ELSE NULL END,
      CASE WHEN cost.cost_basis = 'area' THEN cost.rate_per_sqm ELSE NULL END,
      cost.finished_width_mm,
      cost.finished_height_mm,
      coalesce(cost.quantity, item.quantity),
      cost.manual_material_cost,
      cost.snapshotted_at
    FROM public.quote_item_costs AS cost
    JOIN public.quote_items AS item
      ON item.id = cost.quote_item_id
    WHERE item.quote_version_id = p_quote_version_id
      AND cost.cost_kind <> 'composite'
      AND NOT EXISTS (
        SELECT 1
        FROM public.quote_item_material_components AS existing_component
        WHERE existing_component.quote_item_cost_id = cost.id
      )
  ) AS snapshot;

  SELECT coalesce(array_agg(item.id), ARRAY[]::uuid[])
  INTO v_known_item_ids
  FROM public.quote_items AS item
  WHERE item.quote_version_id = p_quote_version_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'quote_item_id', item.id,
    'cost', to_jsonb(cost),
    'materials', (
      SELECT coalesce(jsonb_agg(to_jsonb(component) ORDER BY component.sort_order), '[]'::jsonb)
      FROM public.quote_item_material_components AS component
      WHERE component.quote_item_cost_id = cost.id
    ),
    'production', (
      SELECT coalesce(jsonb_agg(to_jsonb(production) ORDER BY production.sort_order), '[]'::jsonb)
      FROM public.quote_item_cost_components AS production
      WHERE production.quote_item_cost_id = cost.id
    )
  )), '[]'::jsonb)
  INTO v_preserved_costs
  FROM public.quote_items AS item
  JOIN public.quote_item_costs AS cost
    ON cost.quote_item_id = item.id
  WHERE item.quote_version_id = p_quote_version_id;

  CREATE TEMP TABLE IF NOT EXISTS quote_material_snapshot_claims (
    component_id uuid PRIMARY KEY
  ) ON COMMIT DELETE ROWS;

  DELETE FROM quote_material_snapshot_claims;

  DELETE FROM public.quote_items
  WHERE quote_version_id = p_quote_version_id;

  FOR v_line IN
    SELECT value
    FROM jsonb_array_elements(p_lines)
  LOOP
    v_sort := v_sort + 1;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := round((v_line ->> 'unit_price')::numeric, 2);
    v_line_total := round(v_quantity * v_unit_price, 2);
    v_requested_item_id := NULLIF(btrim(v_line ->> 'id'), '')::uuid;

    IF v_requested_item_id IS NOT NULL
      AND v_requested_item_id = ANY (v_known_item_ids) THEN
      IF v_requested_item_id = ANY (v_claimed_item_ids) THEN
        RAISE EXCEPTION 'Quote line was already used on this save'
          USING ERRCODE = '22023';
      END IF;

      v_claimed_item_ids := array_append(v_claimed_item_ids, v_requested_item_id);
      v_item_id := v_requested_item_id;
    ELSE
      v_item_id := gen_random_uuid();
    END IF;

    INSERT INTO public.quote_items (
      id,
      quote_version_id,
      sort_order,
      title,
      description,
      quantity,
      unit_price,
      line_total,
      is_optional,
      image_storage_path,
      image_file_name,
      image_file_type,
      image_file_size
    )
    VALUES (
      v_item_id,
      p_quote_version_id,
      v_sort,
      btrim(v_line ->> 'title'),
      NULLIF(btrim(v_line ->> 'description'), ''),
      v_quantity,
      v_unit_price,
      v_line_total,
      coalesce((v_line ->> 'is_optional')::boolean, false),
      NULLIF(v_line ->> 'image_storage_path', ''),
      NULLIF(v_line ->> 'image_file_name', ''),
      NULLIF(v_line ->> 'image_file_type', ''),
      NULLIF(v_line ->> 'image_file_size', '')::bigint
    );

    IF coalesce((v_line ->> 'is_optional')::boolean, false) IS FALSE THEN
      v_subtotal := v_subtotal + v_line_total;
    END IF;

    v_cost := v_line -> 'cost';

    IF NOT (v_line ? 'cost') OR v_cost IS NULL OR jsonb_typeof(v_cost) = 'null' THEN
      SELECT element
      INTO v_preserved
      FROM jsonb_array_elements(v_preserved_costs) AS element
      WHERE element ->> 'quote_item_id' = v_item_id::text
      LIMIT 1;

      IF v_preserved IS NOT NULL THEN
        INSERT INTO public.quote_item_costs
        SELECT restored.*
        FROM jsonb_populate_record(
          NULL::public.quote_item_costs,
          v_preserved -> 'cost'
        ) AS restored;

        INSERT INTO public.quote_item_material_components
        SELECT restored.*
        FROM jsonb_populate_recordset(
          NULL::public.quote_item_material_components,
          coalesce(v_preserved -> 'materials', '[]'::jsonb)
        ) AS restored;

        INSERT INTO public.quote_item_cost_components
        SELECT restored.*
        FROM jsonb_populate_recordset(
          NULL::public.quote_item_cost_components,
          coalesce(v_preserved -> 'production', '[]'::jsonb)
        ) AS restored;

        INSERT INTO quote_material_snapshot_claims (component_id)
        SELECT (material ->> 'id')::uuid
        FROM jsonb_array_elements(coalesce(v_preserved -> 'materials', '[]'::jsonb)) AS material
        WHERE NULLIF(material ->> 'id', '') IS NOT NULL
        ON CONFLICT DO NOTHING;

        IF coalesce(jsonb_array_length(v_preserved -> 'materials'), 0) = 0
          AND NULLIF(v_preserved -> 'cost' ->> 'id', '') IS NOT NULL
          AND (v_preserved -> 'cost' ->> 'cost_kind') IS DISTINCT FROM 'composite' THEN
          INSERT INTO quote_material_snapshot_claims (component_id)
          VALUES ((v_preserved -> 'cost' ->> 'id')::uuid)
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;

      CONTINUE;
    END IF;

    IF coalesce((v_cost ->> 'clear')::boolean, false)
      AND NOT (v_cost ? 'materials')
      AND NOT (v_cost ? 'cost_kind')
      AND NOT (v_cost ? 'components') THEN
      CONTINUE;
    END IF;

    -- A materials array stores one composite summary and many material
    -- components. The older single-material payload has no materials key
    -- and keeps the path below.
    IF v_cost ? 'materials' AND jsonb_typeof(v_cost -> 'materials') = 'array' THEN
      PERFORM public.save_composite_quote_line_cost(
        v_item_id,
        v_quantity,
        v_sort,
        v_cost,
        v_existing_materials
      );
      CONTINUE;
    END IF;

    v_kind := v_cost ->> 'cost_kind';
    v_basis := v_cost ->> 'cost_basis';
    v_material_id := NULLIF(v_cost ->> 'material_id', '')::uuid;
    v_product_id := NULLIF(v_cost ->> 'material_supplier_product_id', '')::uuid;
    v_price_id := NULLIF(v_cost ->> 'material_price_id', '')::uuid;
    v_width := NULLIF(v_cost ->> 'finished_width_mm', '')::numeric;
    v_height := NULLIF(v_cost ->> 'finished_height_mm', '')::numeric;
    v_rate := NULL;
    v_area := NULL;
    v_costed_area := NULL;
    v_material_cost := NULL;
    v_manual := NULL;
    v_reason := NULL;
    v_material_name := NULLIF(btrim(v_cost ->> 'material_name'), '');
    v_supplier_name := NULLIF(btrim(v_cost ->> 'supplier_name'), '');
    v_complete := coalesce((v_cost ->> 'costing_status')::text = 'complete', false);
    v_additional := 0;

    IF v_basis = 'area' THEN
      IF v_width IS NOT NULL AND v_height IS NOT NULL AND v_quantity IS NOT NULL THEN
        v_area := public.quote_area_sqm(v_width, v_height, v_quantity);
        v_costed_area := public.quote_costed_area_sqm(v_area);
      END IF;

      IF v_kind = 'approved_material' THEN
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

        v_rate := public.quote_material_rate_per_sqm(
          v_price,
          v_price_unit,
          v_purchase_width,
          v_purchase_height,
          v_purchase_length
        );
      ELSIF v_kind = 'custom_material' THEN
        v_rate := round(NULLIF(v_cost ->> 'rate_per_sqm', '')::numeric, 4);
      END IF;

      IF v_rate IS NOT NULL AND v_costed_area IS NOT NULL THEN
        v_material_cost := round(v_costed_area * v_rate, 2);
      ELSE
        v_complete := false;
        v_material_cost := NULL;
        v_reason := coalesce(
          NULLIF(btrim(v_cost ->> 'incomplete_reason'), ''),
          'Square-metre costing is incomplete'
        );
      END IF;
    ELSIF v_basis = 'manual' THEN
      IF NULLIF(v_cost ->> 'manual_material_cost', '') IS NOT NULL THEN
        v_manual := round((v_cost ->> 'manual_material_cost')::numeric, 2);
        v_material_cost := v_manual;
      ELSE
        v_complete := false;
        v_reason := coalesce(
          NULLIF(btrim(v_cost ->> 'incomplete_reason'), ''),
          'Manual cost is missing'
        );
      END IF;
    ELSE
      RAISE EXCEPTION 'Unknown cost basis'
        USING ERRCODE = '22023';
    END IF;

    IF v_cost ? 'components' AND jsonb_typeof(v_cost -> 'components') = 'array' THEN
      SELECT coalesce(round(sum(round(
        (component ->> 'quantity')::numeric * (component ->> 'unit_cost')::numeric,
        2
      )), 2), 0)
      INTO v_additional
      FROM jsonb_array_elements(v_cost -> 'components') AS component;
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
      snapshotted_by
    )
    VALUES (
      v_item_id,
      v_kind,
      v_basis,
      CASE WHEN v_complete THEN 'complete' ELSE 'incomplete' END,
      CASE WHEN v_kind = 'approved_material' THEN v_material_id ELSE NULL END,
      CASE WHEN v_kind = 'approved_material' THEN v_product_id ELSE NULL END,
      CASE WHEN v_kind = 'approved_material' THEN v_price_id ELSE NULL END,
      v_material_name,
      CASE WHEN v_kind = 'service' THEN NULL ELSE v_supplier_name END,
      CASE WHEN v_basis = 'area' THEN v_rate ELSE NULL END,
      CASE WHEN v_basis = 'area' THEN v_width ELSE NULL END,
      CASE WHEN v_basis = 'area' THEN v_height ELSE NULL END,
      CASE WHEN v_basis = 'area' THEN v_quantity ELSE NULL END,
      CASE WHEN v_basis = 'area' THEN 0.10 ELSE NULL END,
      CASE WHEN v_basis = 'area' THEN v_area ELSE NULL END,
      CASE WHEN v_basis = 'area' THEN v_costed_area ELSE NULL END,
      CASE
        WHEN v_basis = 'area' AND v_material_cost IS NOT NULL THEN v_material_cost
        ELSE NULL
      END,
      CASE WHEN v_basis = 'manual' THEN v_manual ELSE NULL END,
      CASE WHEN v_complete THEN v_material_cost ELSE NULL END,
      v_additional,
      CASE
        WHEN v_complete THEN v_material_cost + v_additional
        ELSE NULL
      END,
      CASE WHEN v_complete THEN NULL ELSE v_reason END,
      auth.uid()
    )
    RETURNING id INTO v_cost_id;

    IF v_cost ? 'components' AND jsonb_typeof(v_cost -> 'components') = 'array' THEN
      v_component_sort := 0;

      FOR v_component IN
        SELECT value
        FROM jsonb_array_elements(v_cost -> 'components')
      LOOP
        v_component_sort := v_component_sort + 1;
        v_component_quantity := (v_component ->> 'quantity')::numeric;
        v_component_unit_cost := round((v_component ->> 'unit_cost')::numeric, 2);

        INSERT INTO public.quote_item_cost_components (
          quote_item_cost_id,
          component_type,
          description,
          quantity,
          unit_cost,
          line_total,
          sort_order
        )
        VALUES (
          v_cost_id,
          v_component ->> 'component_type',
          NULLIF(btrim(v_component ->> 'description'), ''),
          v_component_quantity,
          v_component_unit_cost,
          round(v_component_quantity * v_component_unit_cost, 2),
          v_component_sort
        );
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.quote_versions
  SET
    expiry_date = NULLIF(p_version ->> 'expiry_date', '')::date,
    payment_terms_days = (p_version ->> 'payment_terms_days')::integer,
    introduction = NULLIF(btrim(p_version ->> 'introduction'), ''),
    customer_notes = NULLIF(btrim(p_version ->> 'customer_notes'), ''),
    internal_notes = NULLIF(btrim(p_version ->> 'internal_notes'), ''),
    subtotal = v_subtotal,
    vat_rate = v_vat_rate,
    vat_amount = round(v_subtotal * v_vat_rate, 2),
    total = v_subtotal + round(v_subtotal * v_vat_rate, 2)
  WHERE id = p_quote_version_id;
END;
$$;


-- ---------------------------------------------------------------------------
-- Version copy. Stored material rates, dimensions, wastage and calculated
-- costs are copied. This function does not read material_prices.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.duplicate_quote_version(
  p_source_version_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_source public.quote_versions%ROWTYPE;
  v_next_number integer;
  v_new_version_id uuid;
  v_old_item public.quote_items%ROWTYPE;
  v_new_item_id uuid;
  v_old_cost public.quote_item_costs%ROWTYPE;
  v_new_cost_id uuid;
BEGIN
  IF NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Admin access required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_source
  FROM public.quote_versions
  WHERE id = p_source_version_id
  FOR UPDATE;

  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'Quote version not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.quotes
  WHERE id = v_source.quote_id
  FOR UPDATE;

  SELECT coalesce(max(version_number), 0) + 1
  INTO v_next_number
  FROM public.quote_versions
  WHERE quote_id = v_source.quote_id;

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
    total
  )
  VALUES (
    v_source.quote_id,
    v_next_number,
    'draft',
    v_source.introduction,
    v_source.customer_notes,
    v_source.internal_notes,
    v_source.expiry_date,
    v_source.payment_terms_days,
    v_source.subtotal,
    v_source.vat_rate,
    v_source.vat_amount,
    v_source.total
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
      sort_order
    )
    SELECT
      v_new_cost_id,
      component.component_type,
      component.description,
      component.quantity,
      component.unit_cost,
      component.line_total,
      component.sort_order
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

  UPDATE public.quotes
  SET
    current_version = v_next_number,
    status = 'draft',
    updated_at = now()
  WHERE id = v_source.quote_id;

  RETURN v_new_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_draft_quote_lines(uuid, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duplicate_quote_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_draft_quote_lines(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_quote_version(uuid) TO authenticated;


COMMENT ON TABLE public.quote_item_material_components IS
  'Admin-only material snapshots for one quote line. Rates are historical and are not refreshed by a later supplier price.';

COMMENT ON COLUMN public.quote_item_material_components.snapshotted_rate IS
  'Preserved pounds per square metre for area costing, or pounds per purchase unit for consumption. Re-saving keeps this number unless use_current_rate is requested.';

COMMENT ON COLUMN public.quote_item_material_components.wastage_rate IS
  'Fixed at 0.10 for area costing. Null for consumption and manual costing.';

COMMENT ON COLUMN public.quote_item_costs.default_finished_width_mm IS
  'Default finished width inherited by material components on a composite line.';

COMMENT ON COLUMN public.quote_item_costs.default_finished_height_mm IS
  'Default finished height inherited by material components on a composite line.';

COMMIT;
