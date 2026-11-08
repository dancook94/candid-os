import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const catalog = await import(
  new URL("../lib/materials/initial-import-catalog.ts", import.meta.url).href
);
const importBatches = await import(new URL("../lib/materials/import-batches.ts", import.meta.url).href);
const planMod = await import(new URL("../lib/materials/initial-import-plan.ts", import.meta.url).href);

const {
  INITIAL_IMPORT_CATALOG_VERSION,
  INITIAL_IMPORT_MATERIALS,
  PROTECTED_FOAMALITE_IDENTITY,
  initialImportIdentity,
} = catalog;
const { MEDIUM_IMPORT_CATALOG_VERSION } = await import(
  new URL("../lib/materials/medium-import-catalog.ts", import.meta.url).href
);

const env = readFileSync(".env.local", "utf8");
const sb = createClient(
  env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)![1].trim(),
  env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)![1].trim()
);

const { data: runs } = await sb
  .from("material_import_runs")
  .select("*")
  .eq("catalog_version", INITIAL_IMPORT_CATALOG_VERSION)
  .order("created_at", { ascending: false })
  .limit(1);

const run = runs?.[0] ?? null;
const summary = (run?.summary ?? {}) as Record<string, unknown>;

const [materials, products, prices, suppliers, aliases, quotes] = await Promise.all([
  sb.from("materials").select(
    "id,name,identity_key,costing_unit,costing_pack_quantity,ink_volume_litres,purchase_unit,purchase_width_mm,purchase_height_mm,purchase_length_mm"
  ),
  sb.from("material_supplier_products").select("id,material_id,supplier_id,normalized_description"),
  sb.from("material_prices").select(
    "id,material_supplier_product_id,price,price_unit,effective_date,source_reference"
  ),
  sb.from("suppliers").select("id,name,normalized_name"),
  sb.from("supplier_aliases").select("supplier_id,alias,normalized_alias"),
  sb.from("quote_item_material_components").select("id,snapshotted_rate,cost_basis"),
]);

const mats = materials.data ?? [];
const prods = products.data ?? [];
const priceRows = prices.data ?? [];

const catalogMap = new Map(INITIAL_IMPORT_MATERIALS.map((m) => [initialImportIdentity(m), m]));
const batch1 = mats.filter((r) => catalogMap.has(r.identity_key));
const batch1Ids = new Set(batch1.map((r) => r.id));
const batch1Products = prods.filter((p) => batch1Ids.has(p.material_id));
const batch1ProductIds = new Set(batch1Products.map((p) => p.id));
const batch1Prices = priceRows.filter((p) => batch1ProductIds.has(p.material_supplier_product_id));

const mismatches: Array<Record<string, unknown>> = [];
for (const material of INITIAL_IMPORT_MATERIALS) {
  const row = mats.find((entry) => entry.identity_key === initialImportIdentity(material));
  if (!row) {
    mismatches.push({ key: material.key, field: "missing" });
    continue;
  }
  const pack = row.costing_pack_quantity == null ? null : Number(row.costing_pack_quantity);
  const expectedPack =
    material.costingPackQuantity == null ? null : Number(material.costingPackQuantity);
  if (row.costing_unit !== material.costingUnit) {
    mismatches.push({
      key: material.key,
      field: "costing_unit",
      expected: material.costingUnit,
      actual: row.costing_unit,
    });
  }
  if (pack !== expectedPack) {
    mismatches.push({
      key: material.key,
      field: "costing_pack_quantity",
      expected: expectedPack,
      actual: pack,
    });
  }
  if (material.costingUnit === "litre") {
    const volume = row.ink_volume_litres == null ? null : Number(row.ink_volume_litres);
    if (Math.abs((volume ?? NaN) - (material.inkVolumeLitres ?? NaN)) > 0.0001) {
      mismatches.push({
        key: material.key,
        field: "ink_volume_litres",
        expected: material.inkVolumeLitres,
        actual: volume,
      });
    }
  }
}

const largeSqmIssues = INITIAL_IMPORT_MATERIALS.filter((material) => {
  const large =
    (material.purchaseWidthMm ?? 0) >= 1000 || (material.purchaseLengthMm ?? 0) >= 10000;
  const boardOrRoll = material.purchaseUnit === "sheet" || material.purchaseUnit === "roll";
  if (!large || !boardOrRoll || material.costingUnit !== "square_metre") return false;
  const row = mats.find((entry) => entry.identity_key === initialImportIdentity(material));
  return row?.costing_unit !== "square_metre";
}).map((material) => material.key);

const knifeMaterial = INITIAL_IMPORT_MATERIALS.find((m) => m.key === "tangential-knife-36-pack")!;
const knife = mats.find((r) => r.identity_key === initialImportIdentity(knifeMaterial));
const inkCount = batch1.filter((r) => r.costing_unit === "litre").length;

const identityDupes = Object.entries(
  mats.reduce<Record<string, number>>((acc, row) => {
    acc[row.identity_key] = (acc[row.identity_key] ?? 0) + 1;
    return acc;
  }, {})
).filter(([, count]) => count > 1);

const productDupes = Object.entries(
  prods.reduce<Record<string, number>>((acc, row) => {
    const key = `${row.supplier_id}|${row.normalized_description}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {})
).filter(([, count]) => count > 1);

const foam = mats.find((r) => r.id === "4d3f9293-8c7e-4008-a6d8-241d86d1eed8");
const foamProductIds = prods.filter((p) => p.material_id === foam?.id).map((p) => p.id);
const foamPrice = priceRows.find(
  (p) =>
    foamProductIds.includes(p.material_supplier_product_id) &&
    Math.abs(Number(p.price) - 41.753) <= 0.02
);

const quoteBaselines = [
  { id: "34e05bef-4a25-48b6-9151-8faa7a0a3cee", rate: 8.7335, basis: "area" },
  { id: "d2874549-9b16-42b3-b15e-4fbe8a74359e", rate: 2, basis: "area" },
];
const quoteIssues = quoteBaselines.flatMap((baseline) => {
  const row = (quotes.data ?? []).find((entry) => entry.id === baseline.id);
  if (!row) return [`missing ${baseline.id}`];
  const issues: string[] = [];
  if (Math.abs(Number(row.snapshotted_rate) - baseline.rate) > 0.0001) issues.push(`${baseline.id} rate`);
  if (row.cost_basis !== baseline.basis) issues.push(`${baseline.id} basis`);
  return issues;
});

const snapshot = {
  aliasesReady: true,
  suppliers: (suppliers.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
  })),
  aliases: (aliases.data ?? []).map((row) => ({
    supplierId: row.supplier_id,
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
  })),
  materials: mats.map((row) => ({
    id: row.id,
    name: row.name,
    identityKey: row.identity_key,
    active: true,
  })),
  products: prods.map((row) => ({
    id: row.id,
    materialId: row.material_id,
    supplierId: row.supplier_id,
    description: "",
    normalizedDescription: row.normalized_description,
    isPreferred: true,
    active: true,
  })),
  prices: priceRows.map((row) => ({
    productId: row.material_supplier_product_id,
    price: Number(row.price),
    priceUnit: row.price_unit,
  })),
};

const batch2Plan = importBatches.applyBatchImportGuards(
  planMod.buildInitialImportPlan(
    snapshot,
    "2026-11-07",
    planMod.resolveCatalogImportSource(MEDIUM_IMPORT_CATALOG_VERSION)
  ),
  { runsReady: true, completedCatalogVersions: [INITIAL_IMPORT_CATALOG_VERSION] }
);

const createdMaterials = summary.createdMaterials;
const createdPrices = summary.createdPrices;
const createdSuppliers = summary.createdSuppliers;
const createdAliases = summary.createdAliases;

const checks = {
  importRun: !!run,
  summaryCounts:
    (Array.isArray(createdMaterials) ? createdMaterials.length : 0) === 46 &&
    (Array.isArray(createdPrices) ? createdPrices.length : 0) === 49 &&
    (Array.isArray(createdSuppliers) ? createdSuppliers.length : 0) === 6 &&
    (Array.isArray(createdAliases) ? createdAliases.length : 0) === 14,
  dbBatch1Materials: batch1.length === 46,
  dbBatch1Products: batch1Products.length === 49,
  dbBatch1Prices: batch1Prices.length === 49,
  suppliersAndAliases: (suppliers.data?.length ?? 0) >= 9 && (aliases.data?.length ?? 0) >= 14,
  costing: mismatches.length === 0,
  knifeInkLarge:
    knife?.costing_unit === "each" &&
    Number(knife.costing_pack_quantity) === 5 &&
    inkCount === 13 &&
    largeSqmIssues.length === 0,
  protectedFoam: foam?.identity_key === PROTECTED_FOAMALITE_IDENTITY && !!foamPrice,
  quoteSnapshots: quoteIssues.length === 0,
  noDuplicates: identityDupes.length === 0 && productDupes.length === 0,
  batch2DryRun:
    batch2Plan.canCommit && batch2Plan.counts.conflicts === 0 && batch2Plan.errors.length === 0,
};

const verdict = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";

console.log(
  JSON.stringify(
    {
      verdict,
      batch2SafeToImport: checks.batch2DryRun,
      supabaseRef: "axhkdwgmwhlbsstumndh",
      counts: {
        materials: mats.length,
        material_supplier_products: prods.length,
        material_prices: priceRows.length,
        suppliers: suppliers.data?.length ?? 0,
        supplier_aliases: aliases.data?.length ?? 0,
        quote_item_material_components: quotes.data?.length ?? 0,
        batch1_materials: batch1.length,
        batch1_products: batch1Products.length,
        batch1_prices: batch1Prices.length,
      },
      import_run: run
        ? {
            id: run.id,
            catalog_version: run.catalog_version,
            created_at: run.created_at,
            effectiveDate: summary.effectiveDate,
            preservedMaterialId: summary.preservedMaterialId,
          }
        : null,
      batch2_dry_run: {
        canCommit: batch2Plan.canCommit,
        blockedReason: batch2Plan.blockedReason,
        conflicts: batch2Plan.counts.conflicts,
        materialsToCreate: batch2Plan.counts.materialsToCreate,
        productsToCreate: batch2Plan.counts.productsToCreate,
        pricesToCreate: batch2Plan.counts.pricesToCreate,
        alreadyMatched: batch2Plan.counts.alreadyMatched,
        errors: batch2Plan.errors,
        warnings: batch2Plan.warnings,
      },
      sra3Note:
        "SRA3 sheet costing is defined in batch 2 (medium-approved-batch-2); it is not imported until Batch 2 runs.",
      spotChecks: {
        tangentialKnife: knife
          ? { costing_unit: knife.costing_unit, pack: knife.costing_pack_quantity }
          : null,
        inkLitreCount: inkCount,
        largeFormatIssues: largeSqmIssues,
        foamPrice: foamPrice ? Number(foamPrice.price) : null,
        costingMismatchCount: mismatches.length,
        costingMismatchesSample: mismatches.slice(0, 8),
      },
      checks,
    },
    null,
    2
  )
);
