import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const initialImportPlan = await import(
  new URL("../lib/materials/initial-import-plan.ts", import.meta.url).href
);
const importBatches = await import(new URL("../lib/materials/import-batches.ts", import.meta.url).href);
const initialCatalog = await import(
  new URL("../lib/materials/initial-import-catalog.ts", import.meta.url).href
);
const mediumCatalog = await import(new URL("../lib/materials/medium-import-catalog.ts", import.meta.url).href);

const INITIAL_IMPORT_CATALOG_VERSION = initialCatalog.INITIAL_IMPORT_CATALOG_VERSION;
const PROTECTED_FOAMALITE_IDENTITY = initialCatalog.PROTECTED_FOAMALITE_IDENTITY;
const MEDIUM_IMPORT_CATALOG_VERSION = mediumCatalog.MEDIUM_IMPORT_CATALOG_VERSION;

const env = readFileSync(".env.local", "utf8");
const sb = createClient(
  env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)![1].trim(),
  env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)![1].trim()
);

async function main() {
  const [suppliers, materials, products, prices, aliases] = await Promise.all([
    sb.from("suppliers").select("id, name, normalized_name"),
    sb.from("materials").select("id, name, identity_key, active"),
    sb.from("material_supplier_products").select(
      "id, material_id, supplier_id, supplier_description, normalized_description, is_preferred, active"
    ),
    sb.from("material_prices").select("material_supplier_product_id, price, price_unit"),
    sb.from("supplier_aliases").select("supplier_id, alias, normalized_alias"),
  ]);

  const snapshot = {
    aliasesReady: !aliases.error,
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
    materials: (materials.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      identityKey: row.identity_key,
      active: row.active,
    })),
    products: (products.data ?? []).map((row) => ({
      id: row.id,
      materialId: row.material_id,
      supplierId: row.supplier_id,
      description: row.supplier_description,
      normalizedDescription: row.normalized_description,
      isPreferred: row.is_preferred,
      active: row.active,
    })),
    prices: (prices.data ?? []).flatMap((row) =>
      row.price == null
        ? []
        : [
            {
              productId: row.material_supplier_product_id,
              price: Number(row.price),
              priceUnit: row.price_unit,
            },
          ]
    ),
  };

  const runs = await sb.from("material_import_runs").select("catalog_version");
  const importStatus = {
    runsReady: !runs.error,
    completedCatalogVersions: [
      ...new Set(
        (runs.data ?? [])
          .map((row) => row.catalog_version)
          .filter((value): value is string => typeof value === "string")
      ),
    ],
  };

  const effectiveDate = new Date().toISOString().slice(0, 10);

  const results = [INITIAL_IMPORT_CATALOG_VERSION, MEDIUM_IMPORT_CATALOG_VERSION].map((batch) => {
    const source = initialImportPlan.resolveCatalogImportSource(batch);
    const plan = importBatches.applyBatchImportGuards(
      initialImportPlan.buildInitialImportPlan(snapshot, effectiveDate, source),
      importStatus
    );
    const knife = source.materials.find((material) => material.key === "tangential-knife-36-pack");
    const sra3 = source.materials
      .filter((material) => material.key.includes("sra3") || material.key.includes("greyboard"))
      .map((material) => ({
        key: material.key,
        costingUnit: material.costingUnit,
        pack: material.costingPackQuantity,
      }));

    return {
      batch,
      canCommit: plan.canCommit,
      blockedReason: plan.blockedReason,
      counts: plan.counts,
      errors: plan.errors,
      warnings: plan.warnings,
      costingChecks: {
        sra3Sample: sra3[0],
        greyboard: sra3.find((row) => row.key.includes("greyboard")),
        knife: knife
          ? {
              costingUnit: knife.costingUnit,
              pack: knife.costingPackQuantity,
              price: knife.products[0]?.price,
            }
          : null,
        inkCount: source.materials.filter((material) => material.costingUnit === "litre").length,
        foamaliteBatch1: source.materials.find((material) => material.key.includes("foamalite-3mm"))
          ?.costingUnit,
      },
    };
  });

  const foam = snapshot.materials.find((row) => row.identityKey === PROTECTED_FOAMALITE_IDENTITY);

  console.log(
    JSON.stringify(
      {
        testProject: env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)![1].trim(),
        protectedFoamalite: foam ? { id: foam.id, name: foam.name } : null,
        importRuns: importStatus,
        dryRuns: results,
      },
      null,
      2
    )
  );
}

await main();
