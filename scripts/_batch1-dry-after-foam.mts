import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

import { applyBatchImportGuards } from "../lib/materials/import-batches.ts";
import {
  INITIAL_IMPORT_CATALOG_VERSION,
  PROTECTED_FOAMALITE_IDENTITY,
} from "../lib/materials/initial-import-catalog.ts";
import {
  buildInitialImportPlan,
  resolveCatalogImportSource,
  type InitialImportSnapshot,
} from "../lib/materials/initial-import-plan.ts";

const env = readFileSync(".env.local", "utf8");
const sb = createClient(
  env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)![1].trim(),
  env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)![1].trim()
);

function numeric(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadSnapshot(): Promise<InitialImportSnapshot> {
  const [suppliers, materials, products, prices, aliases] = await Promise.all([
    sb.from("suppliers").select("id, name, normalized_name"),
    sb.from("materials").select("id, name, identity_key, active"),
    sb.from("material_supplier_products").select(
      "id, material_id, supplier_id, supplier_description, normalized_description, is_preferred, active"
    ),
    sb.from("material_prices").select("material_supplier_product_id, price, price_unit"),
    sb.from("supplier_aliases").select("supplier_id, alias, normalized_alias"),
  ]);

  const aliasesReady = !aliases.error;
  return {
    aliasesReady,
    suppliers: (suppliers.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      normalizedName: row.normalized_name,
    })),
    aliases: (aliasesReady ? aliases.data ?? [] : []).map((row) => ({
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
    prices: (prices.data ?? []).flatMap((row) => {
      const price = numeric(row.price);
      return price == null
        ? []
        : [{ productId: row.material_supplier_product_id, price, priceUnit: row.price_unit }];
    }),
  };
}

const snapshot = await loadSnapshot();
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
const plan = applyBatchImportGuards(
  buildInitialImportPlan(
    snapshot,
    effectiveDate,
    resolveCatalogImportSource(INITIAL_IMPORT_CATALOG_VERSION)
  ),
  importStatus
);

console.log(
  JSON.stringify(
    {
      protectedIdentityOnTest: snapshot.materials.some(
        (row) => row.identityKey === PROTECTED_FOAMALITE_IDENTITY
      ),
      catalogVersion: plan.catalogVersion,
      canCommit: plan.canCommit,
      blockedReason: plan.blockedReason,
      counts: plan.counts,
      errors: plan.errors,
      warnings: plan.warnings,
      preservedFoamalite: plan.preserved.filter((row) =>
        /foamalite|pq80/i.test(row.name)
      ),
    },
    null,
    2
  )
);
