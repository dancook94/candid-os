import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { normalizeSupplierDescription } from "@/lib/materials/identity";
import {
  calculateCostPerLitre,
  calculateCostPerSquareMetre,
} from "@/lib/materials/pricing";
import {
  INITIAL_IMPORT_CATALOG_VERSION,
  INITIAL_IMPORT_MATERIALS,
  INITIAL_IMPORT_SOURCE_REFERENCE,
  PROTECTED_FOAMALITE,
  PROTECTED_FOAMALITE_IDENTITY,
  PROTECTED_SUPPLIER_DESCRIPTIONS,
  deferredSupplierAliases,
  initialImportAliases,
  initialImportIdentity,
  initialImportSqlCatalog,
} from "@/lib/materials/initial-import-catalog";
import { MEDIUM_IMPORT_MATERIALS } from "@/lib/materials/medium-import-catalog";
import {
  buildInitialImportPayload,
  buildInitialImportPlan,
  type InitialImportSnapshot,
} from "@/lib/materials/initial-import-plan";
import {
  findSupplierAliasCollisions,
  resolveKnownSupplierName,
  supplierAliasKey,
} from "@/lib/materials/supplier-aliases";

function productionSnapshot(
  overrides: Partial<InitialImportSnapshot> = {}
): InitialImportSnapshot {
  return {
    aliasesReady: true,
    suppliers: [
      {
        id: "supplier-pyramid",
        name: "Pyramid Display Materials",
        normalizedName: "pyramid display materials",
      },
    ],
    aliases: [],
    materials: [
      {
        id: "material-foamalite",
        name: PROTECTED_FOAMALITE.name,
        identityKey: PROTECTED_FOAMALITE_IDENTITY,
        active: true,
      },
    ],
    products: [
      {
        id: "product-foamalite",
        materialId: "material-foamalite",
        supplierId: "supplier-pyramid",
        description: PROTECTED_FOAMALITE.supplierDescription,
        normalizedDescription: normalizeSupplierDescription(
          PROTECTED_FOAMALITE.supplierDescription
        ),
        isPreferred: true,
        active: true,
      },
    ],
    prices: [
      {
        productId: "product-foamalite",
        price: PROTECTED_FOAMALITE.price,
        priceUnit: "sheet",
      },
    ],
    ...overrides,
  };
}

describe("initial material import", () => {
  it("keeps the live Foamalite identity in name order", () => {
    assert.equal(
      PROTECTED_FOAMALITE_IDENTITY,
      "foamalite 5mm pvc 3050mm x 1560mm|5000|white||sheet|3050000|1560000|"
    );
  });

  it("plans the approved set against the current production shape", () => {
    const plan = buildInitialImportPlan(
      productionSnapshot(),
      "2026-09-28"
    );
    const offers = INITIAL_IMPORT_MATERIALS.flatMap((material) => material.products);

    assert.equal(INITIAL_IMPORT_MATERIALS.length, 46);
    assert.equal(offers.length, 50);
    assert.equal(plan.canCommit, true);
    assert.equal(plan.counts.materialsToCreate, 46);
    assert.equal(plan.counts.productsToCreate, 50);
    assert.equal(plan.counts.pricesToCreate, 50);
    assert.equal(plan.counts.suppliersToCreate, 5);
    assert.equal(plan.counts.suppliersMatched, 1);
    assert.equal(plan.counts.aliasesToCreate, 14);
    assert.equal(plan.counts.conflicts, 0);
    assert.deepEqual(
      plan.suppliers.map((supplier) => [supplier.name, supplier.action]),
      [
        ["Pyramid Display Materials", "match"],
        ["Antalis", "create"],
        ["PPB", "create"],
        ["All Print Supplies", "create"],
        ["Papergraphics", "create"],
        ["Perfect Colours", "create"],
      ]
    );
    assert.equal(
      plan.materials.some((material) => material.name === PROTECTED_FOAMALITE.name),
      false
    );
    assert.equal(
      plan.preserved.some((item) => item.name === PROTECTED_FOAMALITE.name),
      true
    );
    assert.match(
      plan.preserved.map((item) => item.name).join(" "),
      /\(PQ80\)/
    );

    const largeFoamalite = INITIAL_IMPORT_MATERIALS[0];
    assert.match(
      initialImportIdentity(largeFoamalite),
      /\|3050000\|1560000\|$/
    );
    assert.doesNotMatch(
      initialImportIdentity(largeFoamalite),
      /\|1560000\|3050000\|$/
    );

    const payload = buildInitialImportPayload(plan, "2026-09-28");
    assert.ok(payload);
    assert.equal(payload.createMaterialKeys.length, 46);
    assert.equal(payload.createProductKeys.length, 50);
    assert.equal(payload.confirmation, "IMPORT APPROVED MATERIALS");
    assert.equal(
      payload.suppliers.find((supplier) => supplier.action === "match")?.expectedId,
      "supplier-pyramid"
    );
  });

  it("checks every approved £/m² and £/litre from the purchase dimensions", () => {
    for (const material of INITIAL_IMPORT_MATERIALS) {
      for (const product of material.products) {
        if (product.priceUnit === "sheet" || product.priceUnit === "roll") {
          const cost = calculateCostPerSquareMetre({
            price: product.price,
            priceUnit: product.priceUnit,
            widthMm: material.purchaseWidthMm,
            heightMm: material.purchaseHeightMm,
            lengthMm: material.purchaseLengthMm,
          });

          assert.ok(cost != null, material.name);
          assert.ok(
            Math.abs((cost ?? 0) - (product.expectedCostPerSquareMetre ?? -1)) <=
              0.02,
            material.name
          );
        } else {
          assert.equal(product.expectedCostPerSquareMetre, null, material.name);
          assert.equal(
            calculateCostPerSquareMetre({
              price: product.price,
              priceUnit: product.priceUnit,
              widthMm: material.purchaseWidthMm,
              heightMm: material.purchaseHeightMm,
              lengthMm: material.purchaseLengthMm,
            }),
            null,
            material.name
          );
        }

        if (material.inkVolumeLitres != null) {
          const perLitre = calculateCostPerLitre(
            product.price,
            material.inkVolumeLitres
          );
          assert.ok(
            Math.abs((perLitre ?? 0) - (product.expectedCostPerLitre ?? -1)) <=
              0.02,
            material.name
          );
        }
      }
    }
  });

  it("resolves approved supplier aliases and still leaves APS unmapped", () => {
    assert.equal(resolveKnownSupplierName("APS"), null);
    assert.equal(resolveKnownSupplierName("aps"), null);
    assert.equal(resolveKnownSupplierName("Candid Creative"), null);
    assert.equal(resolveKnownSupplierName("Candid Creative Ltd"), null);
    assert.equal(
      resolveKnownSupplierName("Pyramid Display Materials Ltd."),
      "Pyramid Display Materials"
    );
    assert.equal(resolveKnownSupplierName("Antalis Ltd"), "Antalis");
    assert.equal(resolveKnownSupplierName("PPB Ltd."), "PPB");
    assert.equal(resolveKnownSupplierName("Papergraphics Limited"), "Papergraphics");
    assert.equal(resolveKnownSupplierName("Perfect Colours Ltd"), "Perfect Colours");
    assert.equal(
      resolveKnownSupplierName("all print supplies ltd."),
      "All Print Supplies"
    );
    assert.equal(deferredSupplierAliases().length, 0);
    assert.equal(
      INITIAL_IMPORT_MATERIALS.some((material) =>
        material.products.some(
          (product) =>
            product.supplierName === "Candid Creative" ||
            product.supplierName === "APS"
        )
      ),
      false
    );
    assert.equal(
      initialImportAliases()
        .map((alias) => alias.alias.toLowerCase())
        .includes("aps"),
      false
    );
    assert.equal(PROTECTED_SUPPLIER_DESCRIPTIONS.length, 2);
    assert.equal(initialImportAliases().length, 14);
    assert.deepEqual(
      initialImportAliases()
        .filter((alias) => alias.canonicalName === "All Print Supplies")
        .map((alias) => alias.alias),
      ["All Print Supplies Ltd", "All Print Supplies Ltd."]
    );
    assert.equal(
      new Set(initialImportAliases().map((alias) => supplierAliasKey(alias.alias)))
        .size,
      initialImportAliases().length
    );
  });

  it("treats case and spacing as one alias, and keeps punctuation conflicts", () => {
    const caseOnly = findSupplierAliasCollisions([
      { canonicalName: "All Print Supplies", alias: "all print supplies ltd." },
      { canonicalName: "All Print Supplies", alias: "All Print Supplies Ltd." },
    ]);
    assert.equal(caseOnly.length, 1);
    assert.equal(caseOnly[0]?.kind, "same-supplier");

    const spaced = findSupplierAliasCollisions([
      { canonicalName: "All Print Supplies", alias: "  All   Print Supplies Ltd  " },
      { canonicalName: "All Print Supplies", alias: "All Print Supplies Ltd" },
    ]);
    assert.equal(spaced.length, 1);
    assert.equal(spaced[0]?.kind, "same-supplier");
    assert.equal(
      supplierAliasKey("  All   Print Supplies Ltd  "),
      supplierAliasKey("All Print Supplies Ltd")
    );

    const punctuation = findSupplierAliasCollisions([
      { canonicalName: "All Print Supplies", alias: "All Print Supplies Ltd" },
      { canonicalName: "All Print Supplies", alias: "All Print Supplies Ltd." },
    ]);
    assert.equal(punctuation.length, 0);

    const crossSupplier = findSupplierAliasCollisions([
      { canonicalName: "All Print Supplies", alias: "All Print Supplies Ltd" },
      { canonicalName: "Papergraphics", alias: "all print supplies ltd" },
    ]);
    assert.equal(crossSupplier.length, 1);
    assert.equal(crossSupplier[0]?.kind, "cross-supplier");

    const blocked = buildInitialImportPlan(
      productionSnapshot(),
      "2026-09-28"
    );
    assert.equal(
      blocked.aliases.some((alias) => alias.action === "conflict"),
      false
    );
  });

  it("blocks the import when the live Foamalite record is missing", () => {
    const plan = buildInitialImportPlan(
      productionSnapshot({ materials: [], products: [], prices: [] }),
      "2026-09-28"
    );

    assert.equal(plan.canCommit, false);
    assert.equal(buildInitialImportPayload(plan, "2026-09-28"), null);
    assert.match(plan.errors.join(" "), /will not recreate it/);
  });

  it("blocks the import when an approved row already has a different price", () => {
    const material = INITIAL_IMPORT_MATERIALS[0];
    const product = material.products[0];
    const snapshot = productionSnapshot();
    snapshot.materials.push({
      id: "material-3mm",
      name: material.name,
      identityKey: initialImportIdentity(material),
      active: true,
    });
    snapshot.products.push({
      id: "product-3mm",
      materialId: "material-3mm",
      supplierId: "supplier-pyramid",
      description: product.supplierDescription,
      normalizedDescription: normalizeSupplierDescription(
        product.supplierDescription
      ),
      isPreferred: true,
      active: true,
    });
    snapshot.prices.push({
      productId: "product-3mm",
      price: 99,
      priceUnit: "sheet",
    });

    const plan = buildInitialImportPlan(snapshot, "2026-09-28");
    const row = plan.materials.find((item) => item.key === material.key);

    assert.equal(row?.action, "conflict");
    assert.equal(plan.canCommit, false);
    assert.equal(buildInitialImportPayload(plan, "2026-09-28"), null);
  });

  it("leaves an exact match out of the create list and still imports the rest", () => {
    const material = INITIAL_IMPORT_MATERIALS[0];
    const snapshot = productionSnapshot();
    snapshot.suppliers.push({
      id: "supplier-antalis",
      name: "Antalis",
      normalizedName: "antalis",
    });
    snapshot.materials.push({
      id: "material-3mm",
      name: material.name,
      identityKey: initialImportIdentity(material),
      active: true,
    });

    for (const [index, product] of material.products.entries()) {
      const productId = `product-3mm-${index}`;
      snapshot.products.push({
        id: productId,
        materialId: "material-3mm",
        supplierId: index === 0 ? "supplier-pyramid" : "supplier-antalis",
        description: product.supplierDescription,
        normalizedDescription: normalizeSupplierDescription(
          product.supplierDescription
        ),
        isPreferred: product.preferred,
        active: true,
      });
      snapshot.prices.push({
        productId,
        price: product.price,
        priceUnit: product.priceUnit,
      });
    }

    const plan = buildInitialImportPlan(snapshot, "2026-09-28");
    const payload = buildInitialImportPayload(plan, "2026-09-28");

    assert.equal(
      plan.materials.find((item) => item.key === material.key)?.action,
      "already_matched"
    );
    assert.equal(plan.canCommit, true);
    assert.equal(payload?.createMaterialKeys.includes(material.key), false);
    assert.equal(
      payload?.createProductKeys.some((key) =>
        material.products.some((product) => product.key === key)
      ),
      false
    );
    assert.equal(payload?.createMaterialKeys.length, 45);
    assert.equal(payload?.createProductKeys.length, 48);
  });

  it("adds the Antalis Foamalite product under the existing Pyramid material", () => {
    const material = INITIAL_IMPORT_MATERIALS[0];
    const pyramid = material.products[0];
    const antalis = material.products[1];
    const snapshot = productionSnapshot();
    snapshot.materials.push({
      id: "material-3mm",
      name: material.name,
      identityKey: initialImportIdentity(material),
      active: true,
    });
    snapshot.products.push({
      id: "product-pyramid",
      materialId: "material-3mm",
      supplierId: "supplier-pyramid",
      description: pyramid.supplierDescription,
      normalizedDescription: normalizeSupplierDescription(
        pyramid.supplierDescription
      ),
      isPreferred: true,
      active: true,
    });
    snapshot.prices.push({
      productId: "product-pyramid",
      price: pyramid.price,
      priceUnit: "sheet",
    });

    const plan = buildInitialImportPlan(snapshot, "2026-09-28");
    const row = plan.materials.find((item) => item.key === material.key);
    const payload = buildInitialImportPayload(plan, "2026-09-28");

    assert.equal(pyramid.supplierName, "Pyramid Display Materials");
    assert.equal(pyramid.preferred, true);
    assert.equal(antalis.supplierName, "Antalis");
    assert.equal(antalis.preferred, false);
    assert.equal(antalis.price, 23.35);
    assert.equal(row?.action, "extend");
    assert.equal(payload?.createMaterialKeys.includes(material.key), false);
    assert.equal(payload?.createProductKeys.includes(antalis.key), true);
    assert.equal(payload?.createProductKeys.includes(pyramid.key), false);
  });

  it("keeps Pyramid and Antalis under one Foamalite 5mm 2440 sheet", () => {
    const material = INITIAL_IMPORT_MATERIALS.find(
      (item) => item.key === "foamalite-5mm-2440x1220"
    );
    assert.ok(material);
    assert.deepEqual(
      material.products.map((product) => [product.supplierName, product.price, product.preferred]),
      [
        ["Pyramid Display Materials", 25.99, true],
        ["Antalis", 23.77, false],
      ]
    );
    assert.equal(
      INITIAL_IMPORT_MATERIALS.filter((item) => item.products.length > 1).map(
        (item) => item.key
      ).join(","),
      [
        "foamalite-3mm-3050x1560",
        "foamalite-3mm-2440x1220",
        "foamalite-5mm-2440x1220",
        "hips-1mm-2440x1220",
      ].join(",")
    );
  });

  it("uses the validated opening prices and natural purchase units", () => {
    const priceOf = (key: string, supplier: string) => {
      const material = INITIAL_IMPORT_MATERIALS.find((item) => item.key === key);
      return material?.products.find((product) => product.supplierName === supplier)
        ?.price;
    };

    assert.equal(priceOf("dibond-sigwhite-3mm-1220x2440", "Pyramid Display Materials"), 26.69);
    assert.equal(priceOf("dibond-eco-3mm-1500x3050", "Pyramid Display Materials"), 41.15);
    assert.equal(priceOf("hips-1mm-2440x1220", "PPB"), 26);
    const hips = INITIAL_IMPORT_MATERIALS.find((item) => item.key === "hips-1mm-2440x1220");
    assert.equal(hips?.products.length, 2);
    assert.equal(
      hips?.products.find((product) => product.key === "hips-1mm-2440x1220--ppb-ps1275-p91")
        ?.preferred,
      false
    );
    assert.equal(priceOf("coala-white-3mm-3050x1500", "Antalis"), 55.25);
    assert.equal(priceOf("coala-white-3mm-2440x1220", "Antalis"), 35.94);
    assert.equal(priceOf("coala-silver-3mm-1220x2440", "Antalis"), 45.44);
    assert.equal(priceOf("hp-730-photo-black-300", "Papergraphics"), 130);
    assert.equal(priceOf("hp-882-magenta-5000", "Perfect Colours"), 331.34);
    assert.equal(priceOf("foamalite-3mm-2440x1220", "Antalis"), 14.6);

    const openingPrices = INITIAL_IMPORT_MATERIALS.flatMap((material) =>
      material.products.map((product) => product.price)
    );
    for (const outlier of [38.79, 60.46, 550, 520, 26.13]) {
      assert.equal(openingPrices.includes(outlier), false, String(outlier));
    }

    assert.equal(
      INITIAL_IMPORT_MATERIALS.find((item) => item.key === "tangential-knife-36-pack")
        ?.purchaseUnit,
      "pack"
    );
    assert.equal(
      INITIAL_IMPORT_MATERIALS.find((item) => item.key === "hp-730-photo-black-300")
        ?.purchaseUnit,
      "unit"
    );
    assert.equal(
      INITIAL_IMPORT_MATERIALS.find((item) => item.key === "hp-730-photo-black-300")
        ?.inkVolumeLitres,
      0.3
    );
    assert.equal(
      INITIAL_IMPORT_MATERIALS.find((item) => item.key === "showcard-strut-240")
        ?.purchaseUnit,
      "unit"
    );
  });

  it("refuses a supplier description that already belongs to another material", () => {
    const material = INITIAL_IMPORT_MATERIALS.find(
      (item) => item.key === "correx-1524x3050-3-5mm"
    );
    assert.ok(material);
    const product = material.products[0];
    const snapshot = productionSnapshot();
    snapshot.products.push({
      id: "product-other",
      materialId: "material-foamalite",
      supplierId: "supplier-pyramid",
      description: product.supplierDescription,
      normalizedDescription: normalizeSupplierDescription(
        product.supplierDescription
      ),
      isPreferred: false,
      active: true,
    });

    const plan = buildInitialImportPlan(snapshot, "2026-09-28");
    const row = plan.materials.find((item) => item.key === material.key);

    assert.equal(row?.action, "conflict");
    assert.equal(plan.canCommit, false);
    assert.equal(buildInitialImportPayload(plan, "2026-09-28"), null);
  });

  it("refuses to commit before the alias migration is available", () => {
    const plan = buildInitialImportPlan(
      productionSnapshot({ aliasesReady: false }),
      "2026-09-28"
    );

    assert.equal(plan.canCommit, false);
    assert.match(plan.blockedReason ?? "", /migration/);
  });

  it("keeps the import admin-only and confirmation-gated", async () => {
    const action = await readFile(
      new URL("./initial-import.ts", import.meta.url),
      "utf8"
    );
    const page = await readFile(
      new URL("../../app/admin/materials/import/page.tsx", import.meta.url),
      "utf8"
    );
    const route = await readFile(
      new URL(
        "../../app/api/admin/materials/initial-import/route.ts",
        import.meta.url
      ),
      "utf8"
    );

    assert.match(action, /verifyApprovedAdmin/);
    assert.match(action, /isInitialImportConfirmation/);
    assert.match(page, /requireAdminPageAccess/);
    assert.match(route, /catalogVersion/);
    assert.match(route, /mode === "commit"/);
    assert.doesNotMatch(page, /commitInitialMaterialImport/);
  });

  it("keeps the database catalog aligned with the approved records", async () => {
    const sql = await readFile(
      new URL(
        "../../supabase/migrations/20261110120000_consolidate_hips_duplicate.sql",
        import.meta.url
      ),
      "utf8"
    );
    const catalogMatch = sql.match(
      /v_catalog jsonb := \$catalog\$([\s\S]*?)\$catalog\$::jsonb/
    );
    const aliasMatch = sql.match(
      /v_aliases jsonb := \$aliases\$([\s\S]*?)\$aliases\$::jsonb/
    );

    assert.ok(catalogMatch);
    assert.ok(aliasMatch);

    const catalog = JSON.parse(catalogMatch[1]);
    const aliases = JSON.parse(aliasMatch[1]);

    assert.equal(catalog.length, 46);
    assert.deepEqual(catalog, initialImportSqlCatalog());
    assert.deepEqual(aliases, initialImportAliases());
    assert.match(sql, new RegExp(PROTECTED_FOAMALITE_IDENTITY.replace(/[|]/g, "\\|")));
    assert.match(sql, new RegExp(INITIAL_IMPORT_CATALOG_VERSION));
    assert.match(sql, new RegExp(INITIAL_IMPORT_SOURCE_REFERENCE));
    assert.doesNotMatch(sql, /APS/);
    assert.doesNotMatch(catalogMatch[1], /PQ80/);
    assert.match(sql, /UPDATE public\.materials[\s\S]*SET active = false/);
    assert.match(sql, /RAISE EXCEPTION 'Material already exists:/);
    assert.match(sql, /RAISE EXCEPTION 'Protected Foamalite record cannot be imported'/);
    assert.match(sql, /RAISE EXCEPTION 'Supplier product already exists:/);
    assert.match(
      sql,
      /RAISE EXCEPTION 'Approved supplier aliases are not unique after normalisation'/
    );
    assert.match(
      sql,
      /RAISE EXCEPTION 'Supplier alias is claimed by more than one supplier'/
    );
    assert.match(sql, /RAISE EXCEPTION 'Supplier alias already exists:/);
    assert.match(sql, /ink_volume_litres/);
    assert.equal(sql.includes("initial-approved-9"), false);
  });
});

describe("medium import catalog", () => {
  it("does not define a second HIPS 2440×1220 material", () => {
    assert.equal(MEDIUM_IMPORT_MATERIALS.length, 35);
    assert.equal(
      MEDIUM_IMPORT_MATERIALS.some((item) => item.name.includes("PS1275 P91")),
      false
    );
  });
});
