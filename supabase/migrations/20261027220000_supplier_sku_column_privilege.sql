-- Lock supplier_sku to the confirmation function and freeze a saved value.
-- Applied manually to Test project axhkdwgmwhlbsstumndh.
-- This replaces the role comparison in guard_material_supplier_product_sku.
-- It does not change confirmation validation, prices, or existing rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_material_supplier_product_sku()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(OLD.supplier_sku, '')), '') IS NOT NULL
     AND NEW.supplier_sku IS DISTINCT FROM OLD.supplier_sku THEN
    RAISE EXCEPTION 'A confirmed supplier SKU cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE UPDATE ON TABLE public.material_supplier_products FROM authenticated, service_role;

GRANT UPDATE (
  material_id,
  supplier_id,
  supplier_description,
  normalized_description,
  is_preferred,
  active
) ON public.material_supplier_products TO authenticated, service_role;

COMMIT;
