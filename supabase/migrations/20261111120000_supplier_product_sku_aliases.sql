CREATE TABLE IF NOT EXISTS public.material_supplier_product_sku_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  material_supplier_product_id uuid NOT NULL
    REFERENCES public.material_supplier_products (id) ON DELETE RESTRICT,
  supplier_sku text NOT NULL,
  normalized_sku text NOT NULL,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_from_invoice_line_id uuid REFERENCES public.supplier_invoice_lines (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_supplier_product_sku_aliases_sku_not_blank CHECK (btrim(supplier_sku) <> ''),
  CONSTRAINT material_supplier_product_sku_aliases_normalized_not_blank CHECK (btrim(normalized_sku) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS material_supplier_product_sku_aliases_supplier_sku_idx
  ON public.material_supplier_product_sku_aliases (supplier_id, lower(supplier_sku));

CREATE INDEX IF NOT EXISTS material_supplier_product_sku_aliases_product_idx
  ON public.material_supplier_product_sku_aliases (material_supplier_product_id);

CREATE OR REPLACE FUNCTION public.material_supplier_product_sku_aliases_normalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.supplier_sku := btrim(NEW.supplier_sku);
  NEW.normalized_sku := lower(NEW.supplier_sku);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS material_supplier_product_sku_aliases_normalize
  ON public.material_supplier_product_sku_aliases;
CREATE TRIGGER material_supplier_product_sku_aliases_normalize
  BEFORE INSERT OR UPDATE ON public.material_supplier_product_sku_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.material_supplier_product_sku_aliases_normalize();

CREATE OR REPLACE FUNCTION public.material_supplier_product_sku_aliases_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_product public.material_supplier_products%ROWTYPE;
BEGIN
  SELECT *
  INTO v_product
  FROM public.material_supplier_products
  WHERE id = NEW.material_supplier_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier product not found' USING ERRCODE = '23503';
  END IF;

  IF v_product.supplier_id IS DISTINCT FROM NEW.supplier_id THEN
    RAISE EXCEPTION 'The SKU alias must belong to the same supplier as the product'
      USING ERRCODE = '23514';
  END IF;

  IF v_product.supplier_sku IS NOT NULL
    AND lower(btrim(v_product.supplier_sku)) = NEW.normalized_sku
  THEN
    RAISE EXCEPTION 'This SKU is already the canonical supplier SKU for that product'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS material_supplier_product_sku_aliases_check
  ON public.material_supplier_product_sku_aliases;
CREATE TRIGGER material_supplier_product_sku_aliases_check
  BEFORE INSERT OR UPDATE ON public.material_supplier_product_sku_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.material_supplier_product_sku_aliases_check();

ALTER TABLE public.material_supplier_product_sku_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_supplier_product_sku_aliases_select_admin
  ON public.material_supplier_product_sku_aliases;
CREATE POLICY material_supplier_product_sku_aliases_select_admin
  ON public.material_supplier_product_sku_aliases FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

DROP POLICY IF EXISTS material_supplier_product_sku_aliases_insert_admin
  ON public.material_supplier_product_sku_aliases;
CREATE POLICY material_supplier_product_sku_aliases_insert_admin
  ON public.material_supplier_product_sku_aliases FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

REVOKE ALL ON TABLE public.material_supplier_product_sku_aliases FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.material_supplier_product_sku_aliases TO authenticated;

COMMENT ON TABLE public.material_supplier_product_sku_aliases IS
  'Alternate supplier item codes that map to an existing material_supplier_products row. Canonical supplier_sku is never overwritten here.';
