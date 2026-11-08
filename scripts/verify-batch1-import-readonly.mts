import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const catalog = await import(
  new URL("../lib/materials/initial-import-catalog.ts", import.meta.url).href
);

const {
  INITIAL_IMPORT_CATALOG_VERSION,
  INITIAL_IMPORT_MATERIALS,
  PROTECTED_FOAMALITE_IDENTITY,
  initialImportIdentity,
  initialImportAliases,
  initialImportSupplierNames,
} = catalog;

const PRE_IMPORT_MATERIAL_IDS = new Set([
  "88d021a6-0c53-4838-8a4b-f222cd22f905",
  "d9fd0a24-14b9-4043-8a80-282f42f32ff8",
  "b1b5841d-9851-4745-86eb-866fe0296de7",
  "88d3025a-fc9a-40bc-b22a-27f2aa294d24",
  "4d3f9293-8c7e-4008-a6d8-241d86d1eed8",
  "78dbdf6c-db1d-46c4-854e-df731d27183c",
  "01923f94-455d-4634-b006-ad5ac524f845",
]);

const PRE_IMPORT_QUOTE_SNAPSHOTS = [
  { id: "34e05bef-4a25-48b6-9151-8faa7a0a3cee", snapshotted_rate: 8.7335, cost_basis: "area" },
  { id: "d2874549-9b16-42b3-b15e-4fbe8a74359e", snapshotted_rate: 2, cost_basis: "area" },
  { id: "c1ec9c5f-54dd-40d3-9484-cf6b58e0f3c2", snapshotted_rate: 8.7335, cost_basis: "area" },
  { id: "105db233-d93f-47ec-a0be-14f67c69d0d0", snapshotted_rate: 2, cost_basis: "area" },
  { id: "65a98576-e5a0-441c-ab88-df774e93a483", snapshotted_rate: 8.7335, cost_basis: "area" },
];

const PROTECTED_FOAMALITE_ID = "4d3f9293-8c7e-4008-a6d8-241d86d1eed8";
const PROTECTED_FOAMALITE_PRICE = 41.753;

const env = readFileSync(".env.local", "utf8");
const sb = createClient(
  env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)![1].trim(),
  env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)![1].trim()
);

type Finding = { pass: boolean; label: string; detail: unknown };

const findings: Finding[] = [];

function record(pass: boolean, label: string, detail: unknown = null) {
  findings.push({ pass, label, detail });
}

function nearlyEqual(a: number, b: number, tolerance = 0.001) {
  return Math.abs(a - b) <= tolerance;
}

async function main() {
  const runs = await sb
    .from("material_import_runs")
    .select("id,catalog_version,summary,imported_at")
    .eq("catalog_version", INITIAL_IMPORT_CATALOG_VERSION)
    .order("imported_at", { ascending: false });

  const run = runs.data?.[0] ?? null;
  record(
    !runs.error && !!run,
    "1. material_import_runs has initial-approved-46",
    { error: runs.error?.message, run }
  );

  const summary = (run?.summary ?? {}) as Record<string, unknown>;

  const [materials, products, prices, suppliers, aliases] = await Promise.all([
    sb.from("materials").select(
      "id,name,identity_key,active,costing_unit,costing_pack_quantity,ink_volume_litres,purchase_unit,width_mm,height_mm,length_mm,category"
    ),
    sb.from("material_supplier_products").select(
      "id,material_id,supplier_id,supplier_description,normalized_description,is_preferred,active"
    ),
    sb.from("material_prices").select(
      "id,material_supplier_product_id,price,price_unit,effective_from"
    ),
    sb.from("suppliers").select("id,name,normalized_name,active"),
    sb.from("supplier_aliases").select("supplier_id,alias,normalized_alias"),
  ]);

  for (const label of ["materials", "products", "prices", "suppliers", "aliases"]) {
    const result = { materials, products, prices, suppliers, aliases }[label as "materials"];
    record(!result.error, `Load ${label}`, result.error?.message ?? null);
  }

  const mats = materials.data ?? [];
  const prods = products.data ?? [];
  const priceRows = prices.data ?? [];
  const supplierRows = suppliers.data ?? [];
  const aliasRows = aliases.data ?? [];

  const catalogIdentityToKey = new Map(
    INITIAL_IMPORT_MATERIALS.map((material) => [initialImportIdentity(material), material.key])
  );

  const batch1Materials = mats.filter((row) => catalogIdentityToKey.has(row.identity_key));
  const preImportMaterials = mats.filter((row) => PRE_IMPORT_MATERIAL_IDS.has(row.id));

  record(
    preImportMaterials.length === PRE_IMPORT_MATERIAL_IDS.size,
    "3. Pre-import materials still present",
    {
      found: preImportMaterials.length,
      expected: PRE_IMPORT_MATERIAL_IDS.size,
      missing: [...PRE_IMPORT_MATERIAL_IDS].filter(
        (id) => !preImportMaterials.some((row) => row.id === id)
      ),
    }
  );

  const protectedRow = mats.find((row) => row.id === PROTECTED_FOAMALITE_ID);
  record(
    protectedRow?.identity_key === PROTECTED_FOAMALITE_IDENTITY,
    "4a. Protected Foamalite identity unchanged",
    protectedRow
  );

  const protectedProducts = prods.filter((row) => row.material_id === PROTECTED_FOAMALITE_ID);
  const protectedProductIds = new Set(protectedProducts.map((row) => row.id));
  const protectedPrices = priceRows.filter((row) =>
    protectedProductIds.has(row.material_supplier_product_id)
  );
  const foamPrice = protectedPrices.find((row) => nearlyEqual(Number(row.price), PROTECTED_FOAMALITE_PRICE, 0.02));
  record(!!foamPrice, "4b. Protected Foamalite £41.753/sheet preserved", {
    prices: protectedPrices.map((row) => ({
      id: row.id,
      price: row.price,
      unit: row.price_unit,
    })),
  });

  const identityDupes = Object.entries(
    mats.reduce<Record<string, number>>((acc, row) => {
      acc[row.identity_key] = (acc[row.identity_key] ?? 0) + 1;
      return acc;
    }, {})
  ).filter(([, count]) => count > 1);

  record(identityDupes.length === 0, "10a. No duplicate material identity_key", identityDupes);

  const productDupes = Object.entries(
    prods.reduce<Record<string, number>>((acc, row) => {
      const key = `${row.supplier_id}|${row.normalized_description}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {})
  ).filter(([, count]) => count > 1);

  record(productDupes.length === 0, "10b. No duplicate supplier products (supplier+normalized)", productDupes.slice(0, 10));

  const costingMismatches: Array<{ key: string; field: string; expected: unknown; actual: unknown }> =
    [];

  for (const material of INITIAL_IMPORT_MATERIALS) {
    const identity = initialImportIdentity(material);
    const row = mats.find((entry) => entry.identity_key === identity);
    if (!row) {
      costingMismatches.push({
        key: material.key,
        field: "missing_material",
        expected: identity,
        actual: null,
      });
      continue;
    }

    const expectedPack =
      material.costingPackQuantity == null ? null : Number(material.costingPackQuantity);
    const actualPack =
      row.costing_pack_quantity == null ? null : Number(row.costing_pack_quantity);

    if (row.costing_unit !== material.costingUnit) {
      costingMismatches.push({
        key: material.key,
        field: "costing_unit",
        expected: material.costingUnit,
        actual: row.costing_unit,
      });
    }

    if (expectedPack !== actualPack) {
      costingMismatches.push({
        key: material.key,
        field: "costing_pack_quantity",
        expected: expectedPack,
        actual: actualPack,
      });
    }

    if (material.costingUnit === "litre") {
      const inkVol =
        row.ink_volume_litres == null ? null : Number(row.ink_volume_litres);
      if (!nearlyEqual(inkVol ?? NaN, material.inkVolumeLitres ?? NaN, 0.0001)) {
        costingMismatches.push({
          key: material.key,
          field: "ink_volume_litres",
          expected: material.inkVolumeLitres,
          actual: inkVol,
        });
      }
    }
  }

  record(costingMismatches.length === 0, "5–8. Catalog costing + ink volume on all 46 materials", {
    mismatchCount: costingMismatches.length,
    mismatches: costingMismatches.slice(0, 20),
    matchedCount: batch1Materials.length,
  });

  const largeFormatIssues = INITIAL_IMPORT_MATERIALS.filter((material) => {
    const isBoardOrRoll =
      material.purchaseUnit === "sheet" ||
      material.purchaseUnit === "roll" ||
      material.category === "Board";
    const isLarge =
      (material.purchaseWidthMm ?? 0) >= 1000 ||
      (material.purchaseLengthMm ?? 0) >= 10000;
    if (!isBoardOrRoll || !isLarge) return false;
    if (material.costingUnit !== "square_metre") return true;
    const row = mats.find((entry) => entry.identity_key === initialImportIdentity(material));
    return row?.costing_unit !== "square_metre";
  }).map((material) => material.key);

  record(largeFormatIssues.length === 0, "6. Large boards/rolls use square_metre", largeFormatIssues);

  const consumableKeys = [
    "tangential-knife-36-pack",
    "heavy-duty-cutout-knife",
    "hp-latex-printhead-cleaning-kit",
    "showcard-strut-240",
    "showcard-strut-190",
    "showcard-strut-140",
  ];
  const consumableExpectations: Record<string, { unit: string; pack: number | null }> = {
    "tangential-knife-36-pack": { unit: "each", pack: 5 },
    "heavy-duty-cutout-knife": { unit: "each", pack: null },
    "hp-latex-printhead-cleaning-kit": { unit: "each", pack: null },
    "showcard-strut-240": { unit: "each", pack: null },
    "showcard-strut-190": { unit: "each", pack: null },
    "showcard-strut-140": { unit: "each", pack: null },
  };

  const consumableIssues = consumableKeys.flatMap((key) => {
    const material = INITIAL_IMPORT_MATERIALS.find((entry) => entry.key === key);
    if (!material) return [`missing catalog ${key}`];
    const row = mats.find((entry) => entry.identity_key === initialImportIdentity(material));
    if (!row) return [`missing db ${key}`];
    const expected = consumableExpectations[key];
    const issues: string[] = [];
    if (row.costing_unit !== expected.unit) issues.push(`${key} unit ${row.costing_unit}`);
    const pack = row.costing_pack_quantity == null ? null : Number(row.costing_pack_quantity);
    if (pack !== expected.pack) issues.push(`${key} pack ${pack}`);
    return issues;
  });

  record(consumableIssues.length === 0, "7. Knives/struts/cleaning kit costing", consumableIssues);

  const quoteComponents = await sb
    .from("quote_item_material_components")
    .select("id,material_id,snapshotted_rate,cost_basis,sort_order");

  const quoteRows = quoteComponents.data ?? [];
  record(!quoteComponents.error, "Load quote_item_material_components", quoteComponents.error?.message);

  const quoteSnapshotIssues = PRE_IMPORT_QUOTE_SNAPSHOTS.flatMap((baseline) => {
    const row = quoteRows.find((entry) => entry.id === baseline.id);
    if (!row) return [`missing quote component ${baseline.id}`];
    const issues: string[] = [];
    if (!nearlyEqual(Number(row.snapshotted_rate), baseline.snapshotted_rate, 0.0001)) {
      issues.push(`${baseline.id} rate ${row.snapshotted_rate}`);
    }
    if (row.cost_basis !== baseline.cost_basis) {
      issues.push(`${baseline.id} basis ${row.cost_basis}`);
    }
    return issues;
  });

  record(quoteSnapshotIssues.length === 0, "9. Pre-import quote snapshots unchanged", {
    totalComponents: quoteRows.length,
    issues: quoteSnapshotIssues,
  });

  const preImportPriceSnapshot = [
    { productId: "81fd9c4e-6e63-4f4f-835e-c9ff2d7bc089", price: 41.2 },
    { productId: "72404883-e979-4b4d-a42c-13870cfae31c", price: 41.753 },
  ];
  const pricePreserveIssues = preImportPriceSnapshot.flatMap((baseline) => {
    const row = priceRows.find(
      (entry) => entry.material_supplier_product_id === baseline.productId
    );
    if (!row) return [`missing price for product ${baseline.productId}`];
    if (!nearlyEqual(Number(row.price), baseline.price, 0.02)) {
      return [`product ${baseline.productId} price ${row.price}`];
    }
    return [];
  });
  record(pricePreserveIssues.length === 0, "3b. Historical pre-import prices preserved (sample)", pricePreserveIssues);

  const productIdSet = new Set(prods.map((row) => row.id));
  const invoiceLines = await sb
    .from("supplier_invoice_lines")
    .select("id,matched_supplier_product_id,review_status")
    .not("matched_supplier_product_id", "is", null)
    .limit(500);

  const brokenInvoiceMatches = (invoiceLines.data ?? []).filter(
    (row) => row.matched_supplier_product_id && !productIdSet.has(row.matched_supplier_product_id)
  );
  record(brokenInvoiceMatches.length === 0, "11a. Supplier invoice product references valid", {
    checked: invoiceLines.data?.length ?? 0,
    broken: brokenInvoiceMatches.length,
  });

  const materialIdSet = new Set(mats.map((row) => row.id));
  const poLines = await sb
    .from("purchase_order_lines")
    .select("id,material_id,material_supplier_product_id")
    .not("material_id", "is", null)
    .limit(200);

  const brokenPo = (poLines.data ?? []).filter(
    (row) => row.material_id && !materialIdSet.has(row.material_id)
  );
  record(brokenPo.length === 0, "11b. Purchase order material references valid", {
    checked: poLines.data?.length ?? 0,
    broken: brokenPo.length,
  });

  const expectedCatalogProducts = INITIAL_IMPORT_MATERIALS.reduce(
    (sum, material) => sum + material.products.length,
    0
  );
  const expectedAliases = initialImportAliases().length;
  const catalogSupplierNames = initialImportSupplierNames();

  const importedProductKeys = new Set(
    prods
      .filter((row) => {
        const mat = mats.find((m) => m.id === row.material_id);
        return mat && catalogIdentityToKey.has(mat.identity_key);
      })
      .map((row) => row.id)
  );

  const importedPriceCount = priceRows.filter((row) =>
    importedProductKeys.has(row.material_supplier_product_id)
  ).length;

  record(
    batch1Materials.length === INITIAL_IMPORT_MATERIALS.length,
    "2a. 46 batch-1 materials present by identity",
    { found: batch1Materials.length, expected: INITIAL_IMPORT_MATERIALS.length }
  );

  record(
    importedPriceCount === expectedCatalogProducts,
    "2b. 49 approved opening prices on batch-1 products",
    { found: importedPriceCount, expected: expectedCatalogProducts }
  );

  const summaryCreated = {
    materials: summary.createdMaterials,
    prices: summary.createdPrices,
    suppliers: summary.createdSuppliers,
    aliases: summary.createdAliases,
  };

  record(
    Number(summary.createdMaterials) === 46 &&
      Number(summary.createdPrices) === 49 &&
      Number(summary.createdSuppliers) === 6 &&
      Number(summary.createdAliases) === 14,
    "2c. Import run summary counts",
  { summary: summaryCreated, full: summary }
  );

  const unexpectedMaterials = mats.filter(
    (row) =>
      !PRE_IMPORT_MATERIAL_IDS.has(row.id) &&
      !catalogIdentityToKey.has(row.identity_key) &&
      !row.name.toLowerCase().startsWith("test material")
  );

  const overallPass = findings.every((finding) => finding.pass);

  console.log(
    JSON.stringify(
      {
        verdict: overallPass ? "PASS" : "FAIL",
        batch2SafeToProceed: overallPass && !!run,
        supabaseRef: "axhkdwgmwhlbsstumndh",
        counts: {
          materials: mats.length,
          material_supplier_products: prods.length,
          material_prices: priceRows.length,
          suppliers: supplierRows.length,
          supplier_aliases: aliasRows.length,
          quote_item_material_components: quoteRows.length,
          material_import_runs_initial: runs.data?.length ?? 0,
        },
        findings,
        unexpectedNonCatalogMaterials: unexpectedMaterials.map((row) => ({
          id: row.id,
          name: row.name,
        })),
      },
      null,
      2
    )
  );

  process.exit(overallPass ? 0 : 1);
}

await main();
