import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const initialCatalog = await import(
  new URL("../lib/materials/initial-import-catalog.ts", import.meta.url).href
);
const mediumCatalog = await import(
  new URL("../lib/materials/medium-import-catalog.ts", import.meta.url).href
);

const initialImportSqlCatalog = () => initialCatalog.initialImportSqlCatalog();
const mediumImportSqlCatalog = () => mediumCatalog.mediumImportSqlCatalog();

function replaceCatalogBlock(
  sql: string,
  marker: "catalog" | "medium_catalog",
  catalog: unknown
) {
  const open =
    marker === "catalog"
      ? /v_catalog jsonb := \$catalog\$/
      : /v_medium_catalog jsonb := \$medium_catalog\$/;
  const close =
    marker === "catalog" ? /\$catalog\$::jsonb/ : /\$medium_catalog\$::jsonb/;

  const openMatch = sql.match(open);
  const closeMatch = sql.match(close);

  if (!openMatch || !closeMatch || openMatch.index == null || closeMatch.index == null) {
    throw new Error(`Could not find ${marker} block`);
  }

  const before = sql.slice(0, openMatch.index + openMatch[0].length);
  const after = sql.slice(closeMatch.index);
  const json = JSON.stringify(catalog, null, 2);

  return `${before}\n${json}\n${after}`;
}

const sourcePath = `${root}/supabase/migrations/20261109220000_material_costing_unit.sql`;
let source = readFileSync(sourcePath, "utf8");
const fnStart = source.indexOf("CREATE OR REPLACE FUNCTION public.apply_initial_materials_import");
if (fnStart < 0) {
  throw new Error("apply_initial_materials_import not found");
}

let functionSql = source.slice(fnStart);
const fnEnd = functionSql.match(/^;\s*$/m);
if (!functionSql.trimEnd().endsWith("$$;") && !functionSql.includes("END;\n$$;")) {
  throw new Error("Unexpected function terminator");
}

functionSql = replaceCatalogBlock(functionSql, "catalog", initialImportSqlCatalog());
functionSql = replaceCatalogBlock(functionSql, "medium_catalog", mediumImportSqlCatalog());
functionSql = functionSql.replace(
  "v_expected_materials := 36;",
  "v_expected_materials := 35;"
);

if (mediumImportSqlCatalog().length !== 35) {
  throw new Error(
    `Expected 35 medium catalog materials, got ${mediumImportSqlCatalog().length}`
  );
}

const consolidation = `-- Consolidate duplicate HIPS 2440×1220 catalogue rows (Test-first data repair).
-- Rollback: supabase/migrations/20261110120000_consolidate_hips_duplicate.rollback.sql

DO $$
DECLARE
  v_canon uuid := '7e7eed82-f203-4238-aeb2-c95dde58a287';
  v_dup   uuid := 'e3d871c5-bc9f-4e50-9515-3cc528146a18';
  v_7231  uuid := 'eb0977bd-db00-4097-8b63-73e9f0071bae';
  v_ps    uuid := '00accca3-4de7-42dd-8755-7c7f0579a90b';
  v_block int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE id = v_canon AND active) THEN
    RAISE EXCEPTION 'Canonical material missing or inactive';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.material_supplier_products
    WHERE id = v_ps AND material_id = v_canon AND active
  ) AND NOT EXISTS (SELECT 1 FROM public.materials WHERE id = v_dup AND active) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE id = v_dup AND active) THEN
    RAISE EXCEPTION 'Duplicate material missing or already inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.material_supplier_products
    WHERE id = v_7231 AND material_id = v_canon AND is_preferred AND active
  ) THEN
    RAISE EXCEPTION '7231 product not preferred on canonical';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.material_supplier_products
    WHERE id = v_ps AND material_id = v_dup AND active
  ) THEN
    RAISE EXCEPTION 'PS1275 product not on duplicate material';
  END IF;

  SELECT count(*) INTO v_block
  FROM public.quote_item_material_components
  WHERE material_id = v_dup OR material_supplier_product_id = v_ps;
  IF v_block > 0 THEN
    RAISE EXCEPTION 'Quote components block consolidation (%).', v_block;
  END IF;

  SELECT count(*) INTO v_block FROM public.quote_item_costs WHERE material_id = v_dup;
  IF v_block > 0 THEN RAISE EXCEPTION 'Quote costs block consolidation (%).', v_block; END IF;

  SELECT count(*) INTO v_block
  FROM public.purchase_order_lines
  WHERE material_id = v_dup OR material_supplier_product_id = v_ps;
  IF v_block > 0 THEN RAISE EXCEPTION 'PO lines block consolidation (%).', v_block; END IF;

  SELECT count(*) INTO v_block
  FROM public.supplier_invoice_lines
  WHERE matched_supplier_product_id = v_ps;
  IF v_block > 0 THEN RAISE EXCEPTION 'Invoice lines block consolidation (%).', v_block; END IF;

  UPDATE public.material_supplier_products
  SET is_preferred = false, updated_at = now()
  WHERE id = v_ps;

  UPDATE public.material_supplier_products
  SET material_id = v_canon, updated_at = now()
  WHERE id = v_ps;

  UPDATE public.materials
  SET active = false, updated_at = now()
  WHERE id = v_dup;

  IF (
    SELECT count(*) FROM public.material_supplier_products
    WHERE material_id = v_canon AND active AND is_preferred
  ) <> 1 THEN
    RAISE EXCEPTION 'Canonical must have exactly one preferred product';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.material_supplier_products
    WHERE material_id = v_dup AND active
  ) THEN
    RAISE EXCEPTION 'Duplicate material still has active supplier products';
  END IF;
END $$;
`;

const migrationPath = `${root}/supabase/migrations/20261110120000_consolidate_hips_duplicate.sql`;
const rollbackPath = `${root}/supabase/migrations/20261110120000_consolidate_hips_duplicate.rollback.sql`;

const rollback = `-- Rollback HIPS consolidation (Test only). Run only if no new dependencies were created.

BEGIN;

UPDATE public.material_supplier_products
SET material_id = 'e3d871c5-bc9f-4e50-9515-3cc528146a18',
    is_preferred = true,
    updated_at = now()
WHERE id = '00accca3-4de7-42dd-8755-7c7f0579a90b';

UPDATE public.materials
SET active = true, updated_at = now()
WHERE id = 'e3d871c5-bc9f-4e50-9515-3cc528146a18';

COMMIT;
`;

const migration = `-- HIPS duplicate consolidation + catalogue import definitions (forward only).
-- Target: Candid OS Test (axhkdwgmwhlbsstumndh). Do not apply on Live without review.

BEGIN;

${consolidation}

${functionSql}

GRANT EXECUTE ON FUNCTION public.apply_initial_materials_import(jsonb) TO authenticated;

COMMIT;
`;

writeFileSync(migrationPath, migration);
writeFileSync(rollbackPath, rollback);
console.log("Wrote", migrationPath);
console.log("Wrote", rollbackPath);
