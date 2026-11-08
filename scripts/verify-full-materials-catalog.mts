import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const costingUnit = await import(new URL("../lib/materials/costing-unit.ts", import.meta.url).href);
const { catalogueQuoteDefaults } = costingUnit;

const initialCatalog = await import(
  new URL("../lib/materials/initial-import-catalog.ts", import.meta.url).href
);
const mediumCatalog = await import(
  new URL("../lib/materials/medium-import-catalog.ts", import.meta.url).href
);

const {
  INITIAL_IMPORT_CATALOG_VERSION,
  INITIAL_IMPORT_MATERIALS,
  PROTECTED_FOAMALITE_IDENTITY,
  initialImportIdentity,
} = initialCatalog;
const {
  MEDIUM_IMPORT_CATALOG_VERSION,
  MEDIUM_IMPORT_MATERIALS,
  MEDIUM_IMPORT_EXISTING_MATERIAL_KEYS,
  mediumImportIdentity,
} = mediumCatalog;

const ALL_CATALOG = [
  ...INITIAL_IMPORT_MATERIALS.map((m) => ({
    batch: INITIAL_IMPORT_CATALOG_VERSION,
    material: m,
    identity: initialImportIdentity(m),
  })),
  ...MEDIUM_IMPORT_MATERIALS.map((m) => ({
    batch: MEDIUM_IMPORT_CATALOG_VERSION,
    material: m,
    identity: mediumImportIdentity(m),
  })),
];

const QUOTE_BASELINE = [
  { id: "34e05bef-4a25-48b6-9151-8faa7a0a3cee", rate: 8.7335, basis: "area" },
  { id: "d2874549-9b16-42b3-b15e-4fbe8a74359e", rate: 2, basis: "area" },
  { id: "c1ec9c5f-54dd-40d3-9484-cf6b58e0f3c2", rate: 8.7335, basis: "area" },
  { id: "105db233-d93f-47ec-a0be-14f67c69d0d0", rate: 2, basis: "area" },
  { id: "65a98576-e5a0-441c-ab88-df774e93a483", rate: 8.7335, basis: "area" },
];

const env = readFileSync(".env.local", "utf8");
const sb = createClient(
  env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)![1].trim(),
  env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)![1].trim()
);

function nearlyEqual(a: number, b: number, tolerance = 0.02) {
  return Math.abs(a - b) <= tolerance;
}

function preferredProduct(material: (typeof INITIAL_IMPORT_MATERIALS)[number]) {
  return material.products.find((p) => p.preferred) ?? material.products[0]!;
}

async function main() {
  const runsRes = await sb
    .from("material_import_runs")
    .select("*")
    .order("created_at", { ascending: true });

  const runs = runsRes.data ?? [];
  const run1 = runs.find((r) => r.catalog_version === INITIAL_IMPORT_CATALOG_VERSION);
  const run2 = runs.find((r) => r.catalog_version === MEDIUM_IMPORT_CATALOG_VERSION);

  const [materials, products, prices, suppliers, aliases, quotes] = await Promise.all([
    sb.from("materials").select(
      "id,name,identity_key,category,thickness_mm,colour,finish,costing_unit,costing_pack_quantity,ink_volume_litres,purchase_unit,purchase_width_mm,purchase_height_mm,purchase_length_mm"
    ),
    sb.from("material_supplier_products").select(
      "id,material_id,supplier_id,supplier_description,normalized_description,is_preferred,active"
    ),
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
  const supplierMap = new Map((suppliers.data ?? []).map((s) => [s.id, s.name]));

  const findings: Array<{ pass: boolean; label: string; detail?: unknown }> = [];
  const pass = (label: string, detail?: unknown) => findings.push({ pass: true, label, detail });
  const fail = (label: string, detail?: unknown) => findings.push({ pass: false, label, detail });

  if (run1 && run2 && runs.length >= 2) {
    pass("1. Both import runs recorded", {
      batch1: { id: run1.id, created_at: run1.created_at },
      batch2: { id: run2.id, created_at: run2.created_at },
      totalRuns: runs.length,
    });
  } else {
    fail("1. Both import runs recorded", { runs: runs.map((r) => r.catalog_version), count: runs.length });
  }

  const expectedCounts = {
    materials: 87,
    products: 94,
    prices: 95,
    suppliers: 9,
    aliases: 15,
    importRuns: 2,
  };
  const actual = {
    materials: mats.length,
    products: prods.length,
    prices: priceRows.length,
    suppliers: suppliers.data?.length ?? 0,
    aliases: aliases.data?.length ?? 0,
    importRuns: runs.length,
  };

  if (Object.entries(expectedCounts).every(([k, v]) => actual[k as keyof typeof actual] === v)) {
    pass("2. Final database counts", { expected: expectedCounts, actual });
  } else {
    fail("2. Final database counts", { expected: expectedCounts, actual });
  }

  const summary2 = (run2?.summary ?? {}) as Record<string, unknown>;
  const createdM2 = summary2.createdMaterials;
  const createdP2 = summary2.createdPrices;
  const createdMatLen = Array.isArray(createdM2) ? createdM2.length : 0;
  const createdPriceLen = Array.isArray(createdP2) ? createdP2.length : 0;
  const matchedMaterials = summary2.matchedMaterials ?? summary2.matchedMaterialKeys;

  if (createdMatLen === 34 && createdPriceLen === 36) {
    pass("3. Batch 2 summary: 34 materials, 36 prices created", {
      createdMaterials: createdMatLen,
      createdPrices: createdPriceLen,
      createdProducts: Array.isArray(summary2.createdProducts)
        ? (summary2.createdProducts as unknown[]).length
        : null,
      matched: matchedMaterials,
      existingKeys: MEDIUM_IMPORT_EXISTING_MATERIAL_KEYS,
    });
  } else {
    fail("3. Batch 2 summary counts", {
      createdMaterials: createdMatLen,
      createdPrices: createdPriceLen,
      summary: summary2,
    });
  }

  const batch2ProductsInDb = prods.filter((p) => {
    const mat = mats.find((m) => m.id === p.material_id);
    if (!mat) return false;
    return MEDIUM_IMPORT_MATERIALS.some((c) => mediumImportIdentity(c) === mat.identity_key);
  });

  if (batch2ProductsInDb.length === 38) {
    pass("3b. Batch 2 has 38 supplier products in DB (36 catalog + 2 matched existing)", {
      count: batch2ProductsInDb.length,
    });
  } else {
    fail("3b. Batch 2 supplier products", { count: batch2ProductsInDb.length, expected: 38 });
  }

  const catalogMismatches: Array<Record<string, unknown>> = [];

  for (const entry of ALL_CATALOG) {
    const { material, identity } = entry;
    const row = mats.find((m) => m.identity_key === identity);
    if (!row) {
      catalogMismatches.push({ key: material.key, field: "missing_material" });
      continue;
    }

    const checks: Array<[string, unknown, unknown]> = [
      ["purchase_unit", material.purchaseUnit, row.purchase_unit],
      ["costing_unit", material.costingUnit, row.costing_unit],
      [
        "costing_pack_quantity",
        material.costingPackQuantity ?? null,
        row.costing_pack_quantity == null ? null : Number(row.costing_pack_quantity),
      ],
      ["purchase_width_mm", material.purchaseWidthMm ?? null, row.purchase_width_mm],
      ["purchase_height_mm", material.purchaseHeightMm ?? null, row.purchase_height_mm],
      ["purchase_length_mm", material.purchaseLengthMm ?? null, row.purchase_length_mm],
    ];

    for (const [field, expected, actualValue] of checks) {
      if (expected !== actualValue) {
        catalogMismatches.push({
          key: material.key,
          field,
          expected,
          actual: actualValue,
        });
      }
    }

    if (material.costingUnit === "litre") {
      const vol = row.ink_volume_litres == null ? null : Number(row.ink_volume_litres);
      if (!nearlyEqual(vol ?? NaN, material.inkVolumeLitres ?? NaN, 0.0001)) {
        catalogMismatches.push({
          key: material.key,
          field: "ink_volume_litres",
          expected: material.inkVolumeLitres,
          actual: vol,
        });
      }
    }

    const pref = preferredProduct(material);
    const materialProducts = prods.filter((p) => p.material_id === row.id);
    const preferredRow =
      materialProducts.find((p) => p.is_preferred) ??
      materialProducts.find((p) => supplierMap.get(p.supplier_id) === pref.supplierName);

    if (!preferredRow) {
      catalogMismatches.push({ key: material.key, field: "missing_preferred_product" });
      continue;
    }

    const priceRow = priceRows.find((p) => p.material_supplier_product_id === preferredRow.id);
    if (!priceRow) {
      catalogMismatches.push({ key: material.key, field: "missing_preferred_price" });
      continue;
    }

    if (!nearlyEqual(Number(priceRow.price), pref.price, 0.02)) {
      catalogMismatches.push({
        key: material.key,
        field: "approved_price",
        expected: pref.price,
        actual: Number(priceRow.price),
        unit: priceRow.price_unit,
      });
    }
    if (priceRow.price_unit !== pref.priceUnit) {
      catalogMismatches.push({
        key: material.key,
        field: "price_unit",
        expected: pref.priceUnit,
        actual: priceRow.price_unit,
      });
    }
  }

  if (!catalogMismatches.length) pass("4. Full catalogue match (82 materials)", { checked: ALL_CATALOG.length });
  else
    fail("4. Full catalogue match", {
      mismatchCount: catalogMismatches.length,
      sample: catalogMismatches.slice(0, 12),
    });

  const sra3 = MEDIUM_IMPORT_MATERIALS.find((m) => m.key === "edixion-offset-350-sra3")!;
  const grey = MEDIUM_IMPORT_MATERIALS.find((m) => m.key === "emblem-greyboard-300-450x640")!;
  const knife = INITIAL_IMPORT_MATERIALS.find((m) => m.key === "tangential-knife-36-pack")!;
  const strut = INITIAL_IMPORT_MATERIALS.find((m) => m.key === "showcard-strut-240")!;
  const cleaning = INITIAL_IMPORT_MATERIALS.find((m) => m.key === "hp-latex-printhead-cleaning-kit")!;
  const largeBoard = INITIAL_IMPORT_MATERIALS.find((m) => m.key === "dibond-eco-3mm-1500x3050")!;
  const vinyl = INITIAL_IMPORT_MATERIALS.find((m) => m.key === "briteline-greyback-1370x50")!;
  const ink = INITIAL_IMPORT_MATERIALS.find((m) => m.key === "hp-730-photo-black-300")!;

  function materialRow(material: (typeof INITIAL_IMPORT_MATERIALS)[number], identityFn: typeof initialImportIdentity) {
    return mats.find((r) => r.identity_key === identityFn(material));
  }

  function quoteDefaultFor(material: (typeof INITIAL_IMPORT_MATERIALS)[number], identityFn: typeof initialImportIdentity) {
    const row = materialRow(material, identityFn);
    const pref = preferredProduct(material);
    if (!row) return null;
    const product = prods.find((p) => p.material_id === row.id && p.is_preferred);
    const price = product ? priceRows.find((p) => p.material_supplier_product_id === product.id) : null;
    if (!price) return null;
    return catalogueQuoteDefaults(
      {
        costingUnit: row.costing_unit,
        costingPackQuantity: row.costing_pack_quantity == null ? null : Number(row.costing_pack_quantity),
        purchaseUnit: row.purchase_unit,
        purchaseWidthMm: row.purchase_width_mm,
        purchaseHeightMm: row.purchase_height_mm,
        purchaseLengthMm: row.purchase_length_mm,
        inkVolumeLitres: row.ink_volume_litres == null ? null : Number(row.ink_volume_litres),
      },
      { price: Number(price.price), priceUnit: price.price_unit as typeof pref.priceUnit }
    );
  }

  const spotIssues: string[] = [];
  const sra3Row = materialRow(sra3, mediumImportIdentity);
  const sra3Def = quoteDefaultFor(sra3, mediumImportIdentity);
  if (sra3Row?.costing_unit !== "sheet" || sra3Def?.costBasis !== "consumption") {
    spotIssues.push("SRA3 costing");
  }

  const greyRow = materialRow(grey, mediumImportIdentity);
  if (greyRow?.costing_unit !== "sheet") spotIssues.push("greyboard costing");

  if (materialRow(largeBoard, initialImportIdentity)?.costing_unit !== "square_metre") spotIssues.push("large board");
  if (materialRow(vinyl, initialImportIdentity)?.costing_unit !== "square_metre") spotIssues.push("vinyl roll");

  if (materialRow(strut, initialImportIdentity)?.costing_unit !== "each") spotIssues.push("strut");
  if (materialRow(cleaning, initialImportIdentity)?.costing_unit !== "each") spotIssues.push("cleaning kit");

  const knifeRow = materialRow(knife, initialImportIdentity);
  const knifeProduct = knifeRow
    ? prods.find((p) => p.material_id === knifeRow.id && p.is_preferred)
    : null;
  const knifePrice = knifeProduct
    ? priceRows.find((p) => p.material_supplier_product_id === knifeProduct.id)
    : null;
  const knifeDefaults = quoteDefaultFor(knife, initialImportIdentity);
  if (
    knifeRow?.costing_unit !== "each" ||
    Number(knifeRow.costing_pack_quantity) !== 5 ||
    !knifePrice ||
    !nearlyEqual(Number(knifePrice.price), 173.4, 0.02) ||
    knifePrice.price_unit !== "pack" ||
    knifeDefaults?.costBasis !== "consumption" ||
    !nearlyEqual(
      knifeDefaults.costBasis === "consumption" ? knifeDefaults.rate : NaN,
      34.68,
      0.02
    )
  ) {
    spotIssues.push("tangential knife pack/blade");
  }

  const inkRow = materialRow(ink, initialImportIdentity);
  const inkDef = quoteDefaultFor(ink, initialImportIdentity);
  if (inkRow?.costing_unit !== "litre" || inkDef?.costBasis !== "consumption") spotIssues.push("ink litre");

  if (!spotIssues.length) {
    pass("5. Spot checks (SRA3, greyboard, m², struts, knife, ink)", {
      sra3: { costing: sra3Row?.costing_unit, quoteRate: sra3Def },
      greyboard: greyRow?.costing_unit,
      knife: {
        packPrice: knifePrice ? Number(knifePrice.price) : null,
        bladeRate: knifeDefaults?.costBasis === "consumption" ? knifeDefaults.rate : null,
      },
      ink: { costing: inkRow?.costing_unit, quoteRate: inkDef },
    });
  } else {
    fail("5. Spot checks", { issues: spotIssues, knifeDefaults, sra3Def });
  }

  const foam = mats.find((r) => r.id === "4d3f9293-8c7e-4008-a6d8-241d86d1eed8");
  const foamProductIds = prods.filter((p) => p.material_id === foam?.id).map((p) => p.id);
  const foamPrice = priceRows.find(
    (p) => foamProductIds.includes(p.material_supplier_product_id) && nearlyEqual(Number(p.price), 41.753, 0.02)
  );
  if (foam?.identity_key === PROTECTED_FOAMALITE_IDENTITY && foamPrice) pass("6. Protected Foamalite");
  else fail("6. Protected Foamalite", { foam, foamPrice });

  const quoteIssues = QUOTE_BASELINE.flatMap((b) => {
    const row = (quotes.data ?? []).find((q) => q.id === b.id);
    if (!row) return [`missing ${b.id}`];
    const issues: string[] = [];
    if (!nearlyEqual(Number(row.snapshotted_rate), b.rate, 0.0001)) issues.push(`${b.id} rate`);
    if (row.cost_basis !== b.basis) issues.push(`${b.id} basis`);
    return issues;
  });
  if (!quoteIssues.length) pass("7. Quote snapshots preserved", { count: quotes.data?.length });
  else fail("7. Quote snapshots", quoteIssues);

  const idDupes = Object.entries(
    mats.reduce<Record<string, number>>((acc, r) => {
      acc[r.identity_key] = (acc[r.identity_key] ?? 0) + 1;
      return acc;
    }, {})
  ).filter(([, c]) => c > 1);

  const prodDupes = Object.entries(
    prods.reduce<Record<string, number>>((acc, r) => {
      const key = `${r.supplier_id}|${r.normalized_description}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {})
  ).filter(([, c]) => c > 1);

  const priceDupes = Object.entries(
    priceRows.reduce<Record<string, number>>((acc, r) => {
      acc[`${r.material_supplier_product_id}|${r.effective_date}|${r.price}`] =
        (acc[`${r.material_supplier_product_id}|${r.effective_date}|${r.price}`] ?? 0) + 1;
      return acc;
    }, {})
  ).filter(([, c]) => c > 1);

  if (!idDupes.length && !prodDupes.length && !priceDupes.length) pass("8. No duplicates");
  else fail("8. Duplicates", { idDupes, prodDupes: prodDupes.slice(0, 5), priceDupes: priceDupes.slice(0, 5) });

  const productIds = new Set(prods.map((p) => p.id));
  const materialIds = new Set(mats.map((m) => m.id));
  const invoiceLines = await sb
    .from("supplier_invoice_lines")
    .select("id,matched_supplier_product_id")
    .not("matched_supplier_product_id", "is", null);
  const brokenInvoices = (invoiceLines.data ?? []).filter(
    (l) => l.matched_supplier_product_id && !productIds.has(l.matched_supplier_product_id)
  );
  const poLines = await sb.from("purchase_order_lines").select("id,material_id").not("material_id", "is", null);
  const brokenPo = (poLines.data ?? []).filter((l) => l.material_id && !materialIds.has(l.material_id));

  if (!brokenInvoices.length && !brokenPo.length) {
    pass("9. Invoice and PO references valid", {
      invoiceLinesChecked: invoiceLines.data?.length ?? 0,
      poLinesChecked: poLines.data?.length ?? 0,
    });
  } else {
    fail("9. References", { brokenInvoices, brokenPo });
  }

  const legacyNonCatalog = mats.filter((m) => {
    const inCatalog = ALL_CATALOG.some((c) => c.identity === m.identity_key);
    const isTest = m.name.toLowerCase().startsWith("test material");
    const isLegacyFoamName = /pq120/i.test(m.name);
    return !inCatalog && !isTest && !isLegacyFoamName;
  });

  const blockers: string[] = [];
  if (legacyNonCatalog.length) {
    blockers.push(
      `${legacyNonCatalog.length} materials outside both catalogues (legacy invoice names may still need alias mapping)`
    );
  }
  if (catalogMismatches.length) blockers.push(`${catalogMismatches.length} catalogue mismatches`);
  if (!run1 || !run2) blockers.push("Missing import run history");

  pass("10. Invoice testing readiness", {
    blockers,
    legacyExtraMaterials: legacyNonCatalog.map((m) => m.name),
    note:
      blockers.length === 0
        ? "Catalogue complete; invoice promotion can use supplier_aliases and material_supplier_products."
        : "Review blockers before relying on automatic invoice line matching.",
  });

  const overallPass = findings.filter((f) => !f.label.startsWith("10.")).every((f) => f.pass);

  console.log(
    JSON.stringify(
      {
        verdict: overallPass ? "PASS" : "FAIL",
        supabaseRef: "axhkdwgmwhlbsstumndh",
        counts: actual,
        importRuns: runs.map((r) => ({
          catalog_version: r.catalog_version,
          id: r.id,
          created_at: r.created_at,
        })),
        findings,
        discrepancies: findings.filter((f) => !f.pass),
        blockers,
      },
      null,
      2
    )
  );

  process.exit(overallPass ? 0 : 1);
}

await main();
