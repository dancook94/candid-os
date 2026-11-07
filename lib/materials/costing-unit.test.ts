import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_IMPORT_MATERIALS,
} from "@/lib/materials/initial-import-catalog";
import {
  catalogueQuoteDefaults,
  invoicePackSheetUnitPriceWarning,
} from "@/lib/materials/costing-unit";
import { calculateCostPerSquareMetre } from "@/lib/materials/pricing";
import {
  MEDIUM_IMPORT_MATERIALS,
} from "@/lib/materials/medium-import-catalog";
import { draftFromApprovedCatalogProduct } from "@/lib/quotes/catalog-defaults";
import { approvedRatePerSquareMetre, estimateQuoteLineCost, emptyQuoteLineCost } from "@/lib/quotes/costing";

function materialByKey(key: string) {
  const material =
    [...INITIAL_IMPORT_MATERIALS, ...MEDIUM_IMPORT_MATERIALS].find((entry) => entry.key === key) ??
    null;
  assert.ok(material, `missing material ${key}`);
  return material;
}

function preferredProduct(material: ReturnType<typeof materialByKey>) {
  return material.products.find((product) => product.preferred) ?? material.products[0]!;
}

test("SRA3 paper defaults to per-sheet consumption", () => {
  const material = materialByKey("edixion-offset-350-sra3");
  const product = preferredProduct(material);
  const defaults = catalogueQuoteDefaults(
    {
      costingUnit: material.costingUnit,
      costingPackQuantity: material.costingPackQuantity ?? null,
      purchaseUnit: material.purchaseUnit,
      purchaseWidthMm: material.purchaseWidthMm,
      purchaseHeightMm: material.purchaseHeightMm,
      purchaseLengthMm: material.purchaseLengthMm,
      inkVolumeLitres: material.inkVolumeLitres,
    },
    { price: product.price, priceUnit: product.priceUnit }
  );

  assert.equal(defaults.costBasis, "consumption");
  if (defaults.costBasis === "consumption") {
    assert.equal(defaults.rate, 0.08254);
    assert.equal(defaults.purchaseUnit, "sheet");
  }

  const draft = draftFromApprovedCatalogProduct(
    {
      id: material.key,
      name: material.name,
      costingUnit: material.costingUnit,
      costingPackQuantity: material.costingPackQuantity ?? null,
      purchaseUnit: material.purchaseUnit,
      purchaseWidthMm: material.purchaseWidthMm,
      purchaseHeightMm: material.purchaseHeightMm,
      purchaseLengthMm: material.purchaseLengthMm,
      inkVolumeLitres: material.inkVolumeLitres,
    },
    {
      id: product.key,
      supplierName: product.supplierName,
      currentPriceId: "price-1",
      currentPrice: product.price,
      currentPriceUnit: product.priceUnit,
    }
  );

  const estimate = estimateQuoteLineCost({
    cost: {
      ...emptyQuoteLineCost(),
      materials: [{ ...draft, inheritQuantity: false, quantity: "100" }],
    },
    quantity: 1,
  });

  assert.equal(estimate.state, "complete");
  assert.equal(estimate.materialCost, 8.25);
});

test("greyboard defaults to per-sheet consumption", () => {
  const material = materialByKey("emblem-greyboard-300-450x640");
  const product = preferredProduct(material);
  const defaults = catalogueQuoteDefaults(
    {
      costingUnit: material.costingUnit,
      costingPackQuantity: null,
      purchaseUnit: material.purchaseUnit,
      purchaseWidthMm: material.purchaseWidthMm,
      purchaseHeightMm: material.purchaseHeightMm,
      purchaseLengthMm: material.purchaseLengthMm,
      inkVolumeLitres: null,
    },
    { price: product.price, priceUnit: product.priceUnit }
  );

  assert.equal(defaults.costBasis, "consumption");
  if (defaults.costBasis === "consumption") {
    assert.equal(defaults.rate, 0.12854);
  }
});

test("Foamalite large sheet uses square-metre area costing", () => {
  const material = materialByKey("foamalite-3mm-3050x1560");
  const product = preferredProduct(material);
  const rate = approvedRatePerSquareMetre({
    price: product.price,
    priceUnit: product.priceUnit,
    widthMm: material.purchaseWidthMm,
    heightMm: material.purchaseHeightMm,
    lengthMm: material.purchaseLengthMm,
  });

  assert.ok(rate != null && rate > 5);

  const defaults = catalogueQuoteDefaults(
    {
      costingUnit: material.costingUnit,
      costingPackQuantity: null,
      purchaseUnit: material.purchaseUnit,
      purchaseWidthMm: material.purchaseWidthMm,
      purchaseHeightMm: material.purchaseHeightMm,
      purchaseLengthMm: material.purchaseLengthMm,
      inkVolumeLitres: null,
    },
    { price: product.price, priceUnit: product.priceUnit }
  );

  assert.equal(defaults.costBasis, "area");
});

test("vinyl roll uses m² rate", () => {
  const material = materialByKey("briteline-greyback-1370x50");
  const product = preferredProduct(material);
  const rate = calculateCostPerSquareMetre({
    price: product.price,
    priceUnit: product.priceUnit,
    widthMm: material.purchaseWidthMm,
    heightMm: material.purchaseHeightMm,
    lengthMm: material.purchaseLengthMm,
  });

  assert.ok(rate != null && rate > 1);
});

test("linear-metre vinyl converts to m²", () => {
  const material = materialByKey("black-matt-permanent-1230");
  const product = preferredProduct(material);
  const defaults = catalogueQuoteDefaults(
    {
      costingUnit: material.costingUnit,
      costingPackQuantity: null,
      purchaseUnit: material.purchaseUnit,
      purchaseWidthMm: material.purchaseWidthMm,
      purchaseHeightMm: material.purchaseHeightMm,
      purchaseLengthMm: material.purchaseLengthMm,
      inkVolumeLitres: null,
    },
    { price: product.price, priceUnit: product.priceUnit }
  );

  assert.equal(defaults.costBasis, "area");
  if (defaults.costBasis === "area") {
    assert.ok(defaults.rate > 3);
  }
});

test("struts and cleaning kit use each consumption", () => {
  for (const key of ["showcard-strut-240", "hp-latex-printhead-cleaning-kit"]) {
    const material = materialByKey(key);
    const product = preferredProduct(material);
    const defaults = catalogueQuoteDefaults(
      {
        costingUnit: material.costingUnit,
        costingPackQuantity: null,
        purchaseUnit: material.purchaseUnit,
        purchaseWidthMm: null,
        purchaseHeightMm: null,
        purchaseLengthMm: null,
        inkVolumeLitres: null,
      },
      { price: product.price, priceUnit: product.priceUnit }
    );

    assert.equal(defaults.costBasis, "consumption");
    if (defaults.costBasis === "consumption") {
      assert.equal(defaults.rate, product.price);
    }
  }
});

test("tangential knife pack prices individual blades", () => {
  const material = materialByKey("tangential-knife-36-pack");
  const product = preferredProduct(material);
  const defaults = catalogueQuoteDefaults(
    {
      costingUnit: material.costingUnit,
      costingPackQuantity: material.costingPackQuantity ?? null,
      purchaseUnit: material.purchaseUnit,
      purchaseWidthMm: null,
      purchaseHeightMm: null,
      purchaseLengthMm: null,
      inkVolumeLitres: null,
    },
    { price: product.price, priceUnit: product.priceUnit }
  );

  assert.equal(defaults.costBasis, "consumption");
  if (defaults.costBasis === "consumption") {
    assert.equal(defaults.rate, 34.68);
  }
});

test("ink uses litre consumption from cartridge price", () => {
  const material = materialByKey("hp-832-cyan-1000");
  const product = preferredProduct(material);
  const defaults = catalogueQuoteDefaults(
    {
      costingUnit: material.costingUnit,
      costingPackQuantity: null,
      purchaseUnit: material.purchaseUnit,
      purchaseWidthMm: null,
      purchaseHeightMm: null,
      purchaseLengthMm: null,
      inkVolumeLitres: material.inkVolumeLitres,
    },
    { price: product.price, priceUnit: product.priceUnit }
  );

  assert.equal(defaults.costBasis, "consumption");
  if (defaults.costBasis === "consumption") {
    assert.equal(defaults.rate, 95);
    assert.equal(defaults.purchaseUnit, "litre");
  }
});

test("pack totals are flagged when sheet costing is expected", () => {
  const warning = invoicePackSheetUnitPriceWarning({
    costingUnit: "sheet",
    packQuantity: 125,
    invoiceUnit: "pack",
    invoiceUnitPrice: 10.3175,
    approvedUnitPrice: 0.08254,
  });

  assert.ok(warning);
});

test("saved quote drafts without costing metadata keep area behaviour", () => {
  const material = materialByKey("foamalite-3mm-3050x1560");
  const product = preferredProduct(material);
  const defaults = catalogueQuoteDefaults(
    {
      costingUnit: null,
      costingPackQuantity: null,
      purchaseUnit: material.purchaseUnit,
      purchaseWidthMm: material.purchaseWidthMm,
      purchaseHeightMm: material.purchaseHeightMm,
      purchaseLengthMm: material.purchaseLengthMm,
      inkVolumeLitres: null,
    },
    { price: product.price, priceUnit: product.priceUnit }
  );

  assert.equal(defaults.costBasis, "area");
});
