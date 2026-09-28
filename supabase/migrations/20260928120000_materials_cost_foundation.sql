-- Phase 1A material cost database.
-- Canonical materials, suppliers, supplier products, and append-only approved prices.
-- Apply manually in Supabase. Do not run automatically from the app.
--
-- Depends on:
--   public.profiles
--   public.is_approved_candid_admin()
--   public.set_updated_at_timestamp()

BEGIN;

-- ---------------------------------------------------------------------------
-- Identity
-- Thousandths keep 5 and 5.0 on the same material without treating NULL as 0.
-- Text is trimmed, internal whitespace is collapsed, and case is ignored.
-- Supplier descriptions are intentionally not part of this key.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.material_identity_key(
  p_name text,
  p_thickness_mm numeric,
  p_colour text,
  p_finish text,
  p_purchase_unit text,
  p_width_mm numeric,
  p_height_mm numeric,
  p_length_mm numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT concat_ws(
    '|',
    lower(regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g')),
    CASE
      WHEN p_thickness_mm IS NULL THEN ''
      ELSE round(p_thickness_mm * 1000)::bigint::text
    END,
    lower(regexp_replace(btrim(COALESCE(p_colour, '')), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(COALESCE(p_finish, '')), '\s+', ' ', 'g')),
    COALESCE(p_purchase_unit, ''),
    CASE
      WHEN p_width_mm IS NULL THEN ''
      ELSE round(p_width_mm * 1000)::bigint::text
    END,
    CASE
      WHEN p_height_mm IS NULL THEN ''
      ELSE round(p_height_mm * 1000)::bigint::text
    END,
    CASE
      WHEN p_length_mm IS NULL THEN ''
      ELSE round(p_length_mm * 1000)::bigint::text
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_material_label(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(btrim(COALESCE(p_value, '')), '\s+', ' ', 'g'), '');
$$;

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT suppliers_normalized_name_not_blank CHECK (btrim(normalized_name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_normalized_name_idx
  ON public.suppliers (normalized_name);

CREATE OR REPLACE FUNCTION public.suppliers_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.name := regexp_replace(btrim(NEW.name), '\s+', ' ', 'g');
  NEW.normalized_name := lower(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suppliers_normalize ON public.suppliers;
CREATE TRIGGER suppliers_normalize
  BEFORE INSERT OR UPDATE ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.suppliers_normalize();

DROP TRIGGER IF EXISTS suppliers_set_updated_at ON public.suppliers;
CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------------
-- Canonical materials
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  thickness_mm numeric,
  colour text,
  finish text,
  purchase_unit text NOT NULL,
  purchase_width_mm numeric,
  purchase_height_mm numeric,
  purchase_length_mm numeric,
  identity_key text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT materials_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT materials_purchase_unit_check CHECK (
    purchase_unit IN (
      'sheet',
      'roll',
      'linear_metre',
      'square_metre',
      'unit',
      'pack'
    )
  ),
  CONSTRAINT materials_thickness_positive CHECK (
    thickness_mm IS NULL OR thickness_mm > 0
  ),
  CONSTRAINT materials_width_positive CHECK (
    purchase_width_mm IS NULL OR purchase_width_mm > 0
  ),
  CONSTRAINT materials_height_positive CHECK (
    purchase_height_mm IS NULL OR purchase_height_mm > 0
  ),
  CONSTRAINT materials_length_positive CHECK (
    purchase_length_mm IS NULL OR purchase_length_mm > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS materials_identity_key_idx
  ON public.materials (identity_key);

CREATE INDEX IF NOT EXISTS materials_active_name_idx
  ON public.materials (active, name);

CREATE OR REPLACE FUNCTION public.materials_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.name := regexp_replace(btrim(NEW.name), '\s+', ' ', 'g');
  NEW.category := public.normalize_material_label(NEW.category);
  NEW.colour := public.normalize_material_label(NEW.colour);
  NEW.finish := public.normalize_material_label(NEW.finish);
  NEW.identity_key := public.material_identity_key(
    NEW.name,
    NEW.thickness_mm,
    NEW.colour,
    NEW.finish,
    NEW.purchase_unit,
    NEW.purchase_width_mm,
    NEW.purchase_height_mm,
    NEW.purchase_length_mm
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS materials_normalize ON public.materials;
CREATE TRIGGER materials_normalize
  BEFORE INSERT OR UPDATE ON public.materials
  FOR EACH ROW
  EXECUTE FUNCTION public.materials_normalize();

DROP TRIGGER IF EXISTS materials_set_updated_at ON public.materials;
CREATE TRIGGER materials_set_updated_at
  BEFORE UPDATE ON public.materials
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------------
-- Supplier products
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.material_supplier_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES public.materials (id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  supplier_sku text,
  supplier_description text NOT NULL,
  normalized_description text NOT NULL,
  is_preferred boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_supplier_products_description_not_blank CHECK (
    btrim(supplier_description) <> ''
  ),
  CONSTRAINT material_supplier_products_preferred_must_be_active CHECK (
    NOT is_preferred OR active
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS material_supplier_products_description_idx
  ON public.material_supplier_products (supplier_id, normalized_description);

CREATE UNIQUE INDEX IF NOT EXISTS material_supplier_products_sku_idx
  ON public.material_supplier_products (supplier_id, lower(supplier_sku))
  WHERE supplier_sku IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS material_supplier_products_one_preferred_idx
  ON public.material_supplier_products (material_id)
  WHERE is_preferred AND active;

CREATE INDEX IF NOT EXISTS material_supplier_products_material_idx
  ON public.material_supplier_products (material_id);

CREATE OR REPLACE FUNCTION public.material_supplier_products_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.supplier_description := regexp_replace(
    btrim(NEW.supplier_description),
    '\s+',
    ' ',
    'g'
  );
  NEW.normalized_description := lower(NEW.supplier_description);
  NEW.supplier_sku := public.normalize_material_label(NEW.supplier_sku);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS material_supplier_products_normalize
  ON public.material_supplier_products;
CREATE TRIGGER material_supplier_products_normalize
  BEFORE INSERT OR UPDATE ON public.material_supplier_products
  FOR EACH ROW
  EXECUTE FUNCTION public.material_supplier_products_normalize();

DROP TRIGGER IF EXISTS material_supplier_products_set_updated_at
  ON public.material_supplier_products;
CREATE TRIGGER material_supplier_products_set_updated_at
  BEFORE UPDATE ON public.material_supplier_products
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE OR REPLACE FUNCTION public.set_material_supplier_product_preferred(
  p_product_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_material_id uuid;
  v_active boolean;
BEGIN
  IF NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Not allowed to update material supplier products'
      USING ERRCODE = '42501';
  END IF;

  SELECT product.material_id, product.active
  INTO v_material_id, v_active
  FROM public.material_supplier_products AS product
  WHERE product.id = p_product_id;

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Supplier product not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION 'Inactive supplier products cannot be preferred'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.material_supplier_products
  SET is_preferred = false
  WHERE material_id = v_material_id
    AND id <> p_product_id
    AND is_preferred;

  UPDATE public.material_supplier_products
  SET is_preferred = true
  WHERE id = p_product_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Approved price history (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.material_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_supplier_product_id uuid NOT NULL
    REFERENCES public.material_supplier_products (id) ON DELETE RESTRICT,
  price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'GBP',
  price_unit text NOT NULL,
  effective_date date NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  source_type text,
  source_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_prices_price_positive CHECK (price > 0),
  CONSTRAINT material_prices_currency_gbp CHECK (currency = 'GBP'),
  CONSTRAINT material_prices_price_unit_check CHECK (
    price_unit IN (
      'sheet',
      'roll',
      'linear_metre',
      'square_metre',
      'unit',
      'pack'
    )
  ),
  CONSTRAINT material_prices_effective_date_sane CHECK (
    effective_date >= DATE '2000-01-01'
    AND effective_date <= DATE '2100-12-31'
  ),
  CONSTRAINT material_prices_source_type_length CHECK (
    source_type IS NULL OR char_length(source_type) <= 40
  ),
  CONSTRAINT material_prices_source_reference_length CHECK (
    source_reference IS NULL OR char_length(source_reference) <= 200
  )
);

CREATE INDEX IF NOT EXISTS material_prices_current_idx
  ON public.material_prices (
    material_supplier_product_id,
    effective_date DESC,
    approved_at DESC,
    created_at DESC
  );

-- ---------------------------------------------------------------------------
-- Access
-- Approved admin and super_admin only. Customers and other roles have no policy.
-- material_prices has no UPDATE or DELETE policy: history is append-only.
-- ---------------------------------------------------------------------------

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_select_admin ON public.suppliers;
CREATE POLICY suppliers_select_admin
  ON public.suppliers FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS suppliers_insert_admin ON public.suppliers;
CREATE POLICY suppliers_insert_admin
  ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS suppliers_update_admin ON public.suppliers;
CREATE POLICY suppliers_update_admin
  ON public.suppliers FOR UPDATE TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS materials_select_admin ON public.materials;
CREATE POLICY materials_select_admin
  ON public.materials FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS materials_insert_admin ON public.materials;
CREATE POLICY materials_insert_admin
  ON public.materials FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS materials_update_admin ON public.materials;
CREATE POLICY materials_update_admin
  ON public.materials FOR UPDATE TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS material_supplier_products_select_admin
  ON public.material_supplier_products;
CREATE POLICY material_supplier_products_select_admin
  ON public.material_supplier_products FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS material_supplier_products_insert_admin
  ON public.material_supplier_products;
CREATE POLICY material_supplier_products_insert_admin
  ON public.material_supplier_products FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS material_supplier_products_update_admin
  ON public.material_supplier_products;
CREATE POLICY material_supplier_products_update_admin
  ON public.material_supplier_products FOR UPDATE TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS material_prices_select_admin ON public.material_prices;
CREATE POLICY material_prices_select_admin
  ON public.material_prices FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS material_prices_insert_admin ON public.material_prices;
CREATE POLICY material_prices_insert_admin
  ON public.material_prices FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

REVOKE ALL ON TABLE public.suppliers FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.materials FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.material_supplier_products FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.material_prices FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON public.suppliers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.materials TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.material_supplier_products TO authenticated;
GRANT SELECT, INSERT ON public.material_prices TO authenticated;

REVOKE ALL ON FUNCTION public.set_material_supplier_product_preferred(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_material_supplier_product_preferred(uuid) TO authenticated;

COMMENT ON TABLE public.materials IS
  'One canonical Candid material. Supplier invoice wording is not the identity.';

COMMENT ON TABLE public.material_prices IS
  'Append-only approved supplier prices. Current price is the latest row for the preferred supplier product.';

COMMIT;
