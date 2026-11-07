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

function patchImportFunction(sql: string) {
  if (!sql.includes("costing_unit")) {
    sql = sql.replace(
      "  v_ink numeric;",
      "  v_ink numeric;\n  v_costing_unit text;\n  v_costing_pack_quantity numeric;"
    );
    sql = sql.replace(
      "    v_ink := (v_item->>'inkVolumeLitres')::numeric;",
      `    v_ink := (v_item->>'inkVolumeLitres')::numeric;
    v_costing_unit := NULLIF(v_item->>'costingUnit', '');
    v_costing_pack_quantity := (v_item->>'costingPackQuantity')::numeric;`
    );
    sql = sql.replace(
      `        ink_volume_litres,
        identity_key,
        active
      )
      VALUES (
        v_name,
        v_category,
        v_thickness,
        v_colour,
        v_finish,
        v_item->>'purchaseUnit',
        v_width,
        v_height,
        v_length,
        v_ink,
        '',
        true
      )`,
      `        ink_volume_litres,
        costing_unit,
        costing_pack_quantity,
        identity_key,
        active
      )
      VALUES (
        v_name,
        v_category,
        v_thickness,
        v_colour,
        v_finish,
        v_item->>'purchaseUnit',
        v_width,
        v_height,
        v_length,
        v_ink,
        v_costing_unit,
        v_costing_pack_quantity,
        '',
        true
      )`
    );
  }

  return sql;
}

const initialPath = `${root}/supabase/migrations/20260928190000_supplier_aliases_and_initial_import.sql`;
const mediumPath = `${root}/supabase/migrations/20261001170000_medium_approved_batch_2_import.sql`;

let initialSql = readFileSync(initialPath, "utf8");
initialSql = replaceCatalogBlock(initialSql, "catalog", initialImportSqlCatalog());
initialSql = patchImportFunction(initialSql);
writeFileSync(initialPath, initialSql);

let mediumSql = readFileSync(mediumPath, "utf8");
mediumSql = replaceCatalogBlock(mediumSql, "catalog", initialImportSqlCatalog());
mediumSql = replaceCatalogBlock(mediumSql, "medium_catalog", mediumImportSqlCatalog());
mediumSql = patchImportFunction(mediumSql);
writeFileSync(mediumPath, mediumSql);

const migrationPath = `${root}/supabase/migrations/20261109220000_material_costing_unit.sql`;
const mediumFunction = readFileSync(mediumPath, "utf8");
const functionMatch = mediumFunction.match(
  /CREATE OR REPLACE FUNCTION public\.apply_initial_materials_import[\s\S]*^;\s*$/m
);

if (!functionMatch) {
  throw new Error("Could not extract apply_initial_materials_import");
}

const migration = `-- Material costing unit metadata for quote builder defaults.
-- Apply manually on Test. Does not change approved prices.

BEGIN;

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS costing_unit text;

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS costing_pack_quantity numeric;

ALTER TABLE public.materials
  DROP CONSTRAINT IF EXISTS materials_costing_unit_check;

ALTER TABLE public.materials
  ADD CONSTRAINT materials_costing_unit_check CHECK (
    costing_unit IS NULL
    OR costing_unit IN (
      'square_metre',
      'sheet',
      'each',
      'pack',
      'litre',
      'linear_metre'
    )
  );

ALTER TABLE public.materials
  DROP CONSTRAINT IF EXISTS materials_costing_pack_quantity_positive;

ALTER TABLE public.materials
  ADD CONSTRAINT materials_costing_pack_quantity_positive CHECK (
    costing_pack_quantity IS NULL OR costing_pack_quantity > 0
  );

${functionMatch[0]}

COMMIT;
`;

writeFileSync(migrationPath, migration);
console.log("Synced import SQL catalogs and wrote", migrationPath);
