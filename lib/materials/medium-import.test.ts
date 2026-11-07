import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeSupplierDescription } from "@/lib/materials/identity";
import { readFile } from "node:fs/promises";

import {
  INITIAL_IMPORT_CATALOG_VERSION,
  INITIAL_IMPORT_CONFIRMATION,
  INITIAL_IMPORT_MATERIALS,
  PROTECTED_FOAMALITE,
  PROTECTED_FOAMALITE_IDENTITY,
  initialImportIdentity,
  initialImportSqlCatalog,
} from "@/lib/materials/initial-import-catalog";
import {
  buildInitialImportPayload,
  buildInitialImportPlan,
  type InitialImportSnapshot,
} from "@/lib/materials/initial-import-plan";
import {
  MEDIUM_IMPORT_CATALOG_VERSION,
  MEDIUM_IMPORT_EXISTING_MATERIAL_KEYS,
  MEDIUM_IMPORT_MATERIALS,
  mediumImportAliases,
  mediumImportIdentity,
  mediumImportSource,
  mediumImportSqlCatalog,
  mediumImportSupplierNames,
} from "@/lib/materials/medium-import-catalog";

function batchTwoSnapshot(): InitialImportSnapshot {
  const suppliers = mediumImportSupplierNames().map((name) => ({
    id: `supplier-${name}`,
    name,
    normalizedName: name.toLowerCase(),
  }));
  const supplierId = new Map(suppliers.map((supplier) => [supplier.name, supplier.id]));
  const existing = MEDIUM_IMPORT_MATERIALS.filter((material) =>
    MEDIUM_IMPORT_EXISTING_MATERIAL_KEYS.includes(
      material.key as (typeof MEDIUM_IMPORT_EXISTING_MATERIAL_KEYS)[number]
    )
  );

  return {
    aliasesReady: true,
    suppliers: [
      ...suppliers,
      {
        id: "supplier-papergraphics",
        name: "Papergraphics",
        normalizedName: "papergraphics",
      },
    ],
    aliases: mediumImportAliases().map((alias) => ({
      supplierId: supplierId.get(alias.canonicalName) ?? "missing",
      alias: alias.alias,
      normalizedAlias: alias.alias.toLowerCase(),
    })),
    materials: [
      {
        id: "material-foamalite",
        name: PROTECTED_FOAMALITE.name,
        identityKey: PROTECTED_FOAMALITE_IDENTITY,
        active: true,
      },
      ...existing.map((material) => ({
        id: `material-${material.key}`,
        name: material.name,
        identityKey: mediumImportIdentity(material),
        active: true,
      })),
    ],
    products: [
      {
        id: "product-foamalite",
        materialId: "material-foamalite",
        supplierId: "supplier-Pyramid Display Materials",
        description: PROTECTED_FOAMALITE.supplierDescription,
        normalizedDescription: normalizeSupplierDescription(
          PROTECTED_FOAMALITE.supplierDescription
        ),
        isPreferred: true,
        active: true,
      },
      ...existing.flatMap((material) =>
        material.products
          .filter((product) => product.preferred)
          .map((product) => ({
            id: `product-${product.key}`,
            materialId: `material-${material.key}`,
            supplierId: supplierId.get(product.supplierName) ?? "missing",
            description: product.supplierDescription,
            normalizedDescription: normalizeSupplierDescription(
              product.supplierDescription
            ),
            isPreferred: true,
            active: true,
          }))
      ),
    ],
    prices: [
      {
        productId: "product-foamalite",
        price: PROTECTED_FOAMALITE.price,
        priceUnit: "sheet",
      },
      ...existing.flatMap((material) =>
        material.products
          .filter((product) => product.preferred)
          .map((product) => ({
            productId: `product-${product.key}`,
            price: product.price,
            priceUnit: product.priceUnit,
          }))
      ),
    ],
  };
}

describe("medium approved batch 2", () => {
  it("keeps a separate catalog from the first import", () => {
    assert.equal(MEDIUM_IMPORT_CATALOG_VERSION, "medium-approved-batch-2");
    assert.notEqual(MEDIUM_IMPORT_CATALOG_VERSION, INITIAL_IMPORT_CATALOG_VERSION);
    assert.equal(INITIAL_IMPORT_MATERIALS.length, 46);
    assert.equal(MEDIUM_IMPORT_MATERIALS.length, 36);
  });

  it("does not create Candid Creative or map APS", () => {
    const names = mediumImportSupplierNames().map((name) => name.toLowerCase());

    assert.equal(names.some((name) => name.includes("candid")), false);
    assert.equal(names.includes("aps"), false);
    assert.equal(
      names.includes("all print supplies"),
      true
    );
  });

  it("attaches Jiffy and KleenTear to the existing materials and creates the rest", () => {
    const plan = buildInitialImportPlan(
      batchTwoSnapshot(),
      "2026-10-01",
      mediumImportSource()
    );
    const extended = plan.materials.filter((material) => material.action === "extend");
    const created = plan.materials.filter((material) => material.action === "create");

    assert.equal(plan.catalogVersion, "medium-approved-batch-2");
    assert.equal(plan.canCommit, true);
    assert.equal(plan.counts.conflicts, 0);
    assert.deepEqual(
      extended.map((material) => material.name),
      [
        "Bubble Wrap 1500mm",
        "PerfecTear Medium Application Tape 1220mm",
      ]
    );
    assert.equal(created.length, 34);
    assert.equal(plan.counts.materialsToCreate, 34);
    assert.equal(plan.counts.productsToCreate, 36);
    assert.equal(plan.counts.pricesToCreate, 36);
    assert.equal(plan.counts.suppliersToCreate, 0);
    assert.equal(plan.counts.aliasesToCreate, 0);
    assert.equal(plan.counts.alreadyMatched, 2);
    assert.equal(plan.warnings.length, 0);

    const payload = buildInitialImportPayload(plan, "2026-10-01");

    assert.ok(payload);
    assert.equal(payload.catalogVersion, MEDIUM_IMPORT_CATALOG_VERSION);
    assert.equal(payload.confirmation, INITIAL_IMPORT_CONFIRMATION);
    assert.equal(payload.createAliases.length, 0);
    assert.equal(payload.suppliers.length, 5);
    assert.equal(
      payload.suppliers.every((supplier) => supplier.action === "match"),
      true
    );
    assert.equal(payload.createMaterialKeys.length, 34);
    assert.equal(payload.createProductKeys.length, 36);
    assert.equal(payload.createMaterialKeys.includes("bubble-wrap-1500"), false);
    assert.equal(
      payload.createMaterialKeys.includes("perfectear-medium-1220"),
      false
    );
    assert.equal(
      payload.createProductKeys.includes("bubble-wrap-1500--antalis"),
      true
    );
    assert.equal(
      payload.createProductKeys.includes(
        "bubble-wrap-1500--pyramid-display-materials"
      ),
      false
    );
    assert.equal(
      payload.createProductKeys.includes(
        "perfectear-medium-1220--all-print-supplies"
      ),
      true
    );
    assert.equal(
      payload.createProductKeys.includes(
        "perfectear-medium-1220--pyramid-display-materials"
      ),
      false
    );

    const jiffy = plan.materials
      .find((material) => material.key === "bubble-wrap-1500")
      ?.products.find((product) => product.supplierName === "Antalis");
    const kleenTear = plan.materials
      .find((material) => material.key === "perfectear-medium-1220")
      ?.products.find((product) => product.supplierName === "All Print Supplies");

    assert.equal(jiffy?.action, "create");
    assert.equal(jiffy?.preferred, false);
    assert.equal(jiffy?.price, 33.29);
    assert.equal(kleenTear?.action, "create");
    assert.equal(kleenTear?.preferred, false);
    assert.equal(kleenTear?.price, 104.78);
  });

  it("uses each, sheet, roll, and metre prices rather than pack totals", () => {
    const byKey = new Map(
      MEDIUM_IMPORT_MATERIALS.map((material) => [material.key, material])
    );

    assert.equal(byKey.get("edixion-offset-350-sra3")?.products[0].price, 0.08254);
    assert.equal(
      mediumImportSqlCatalog().find(
        (material) => material.key === "edixion-offset-350-sra3"
      )?.products[0].price,
      "0.08254"
    );
    assert.equal(byKey.get("c4-manilla-envelope")?.products[0].price, 0.149);
    assert.equal(byKey.get("hips-1mm-3050x1524")?.products[0].price, 30);
    assert.equal(byKey.get("hips-1mm-3050x1524")?.purchaseWidthMm, 3050);
    assert.equal(byKey.get("hips-1mm-3050x1524")?.purchaseHeightMm, 1524);
    assert.equal(byKey.get("black-matt-permanent-1230")?.purchaseUnit, "linear_metre");
    assert.equal(byKey.get("dol-1480-matt-1370")?.purchaseUnit, "linear_metre");
    assert.equal(byKey.get("mpi-1104-gloss-1370")?.purchaseUnit, "linear_metre");
    assert.equal(byKey.get("p65w-silver-crystal-1600")?.purchaseUnit, "linear_metre");
    assert.equal(byKey.get("su3-70-1560x50")?.purchaseWidthMm, 1560);
    assert.equal(byKey.get("ww300-matt-1371x50")?.products[0].supplierName, "Pyramid Display Materials");
  });

  it("does not duplicate a first-import identity except the two existing materials", () => {
    const firstIdentities = new Map(
      INITIAL_IMPORT_MATERIALS.map((material) => [
        initialImportIdentity(material),
        material.key,
      ])
    );
    const seen = new Set<string>();

    for (const material of MEDIUM_IMPORT_MATERIALS) {
      const identity = mediumImportIdentity(material);
      assert.equal(seen.has(identity), false);
      seen.add(identity);
      const firstKey = firstIdentities.get(identity);

      if (firstKey) {
        assert.equal(
          MEDIUM_IMPORT_EXISTING_MATERIAL_KEYS.includes(
            material.key as (typeof MEDIUM_IMPORT_EXISTING_MATERIAL_KEYS)[number]
          ),
          true
        );
        assert.equal(firstKey, material.key);
      }
    }
  });

  it("keeps both approved catalogs inside the import function", async () => {
    const sql = await readFile(
      new URL(
        "../../supabase/migrations/20261001170000_medium_approved_batch_2_import.sql",
        import.meta.url
      ),
      "utf8"
    );
    const initialMatch = sql.match(
      /v_catalog jsonb := \$catalog\$([\s\S]*?)\$catalog\$::jsonb/
    );
    const mediumMatch = sql.match(
      /v_medium_catalog jsonb := \$medium_catalog\$([\s\S]*?)\$medium_catalog\$::jsonb/
    );

    assert.ok(initialMatch);
    assert.ok(mediumMatch);
    assert.deepEqual(JSON.parse(initialMatch[1]), initialImportSqlCatalog());
    assert.deepEqual(JSON.parse(mediumMatch[1]), mediumImportSqlCatalog());
    assert.match(sql, /initial-approved-46/);
    assert.match(sql, /medium-approved-batch-2/);
    assert.doesNotMatch(sql, /UPDATE public\.materials/);
    assert.doesNotMatch(mediumMatch[1], /APS/);
    assert.doesNotMatch(mediumMatch[1], /Candid/);
    assert.equal(mediumImportSqlCatalog().length, 36);
    assert.equal(initialImportSqlCatalog().length, 46);
  });
});
