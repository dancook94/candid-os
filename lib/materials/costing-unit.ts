import {
  calculateCostPerLitre,
  calculateCostPerSquareMetre,
  type NormalisedCostInput,
} from "@/lib/materials/pricing";
import type { PurchaseUnit } from "@/lib/materials/units";

export const MATERIAL_COSTING_UNITS = [
  "square_metre",
  "sheet",
  "each",
  "pack",
  "litre",
  "linear_metre",
] as const;

export type MaterialCostingUnit = (typeof MATERIAL_COSTING_UNITS)[number];

export const MATERIAL_COSTING_UNIT_LABELS: Record<MaterialCostingUnit, string> = {
  square_metre: "Square metre",
  sheet: "Sheet",
  each: "Each",
  pack: "Pack",
  litre: "Litre",
  linear_metre: "Linear metre",
};

export function isMaterialCostingUnit(value: string): value is MaterialCostingUnit {
  return (MATERIAL_COSTING_UNITS as readonly string[]).includes(value);
}

export function coerceMaterialCostingUnit(value: unknown): MaterialCostingUnit | null {
  if (typeof value !== "string") {
    return null;
  }

  return isMaterialCostingUnit(value) ? value : null;
}

export type MaterialCostingContext = {
  costingUnit: MaterialCostingUnit | null;
  costingPackQuantity: number | null;
  purchaseUnit: PurchaseUnit;
  purchaseWidthMm: number | null;
  purchaseHeightMm: number | null;
  purchaseLengthMm: number | null;
  inkVolumeLitres: number | null;
};

export type ApprovedPriceContext = {
  price: number;
  priceUnit: PurchaseUnit;
};

/** Legacy rows with no costing_unit keep prior quote behaviour. */
export function legacyCostingUnit(
  material: MaterialCostingContext,
  price: ApprovedPriceContext
): MaterialCostingUnit | null {
  if (material.inkVolumeLitres != null && material.inkVolumeLitres > 0) {
    return "litre";
  }

  if (price.priceUnit === "unit" || price.priceUnit === "pack") {
    return price.priceUnit === "pack" ? "pack" : "each";
  }

  const ratePerSqm = calculateCostPerSquareMetre(normalisedCostInput(material, price));

  if (ratePerSqm != null) {
    return "square_metre";
  }

  return null;
}

export function resolvedCostingUnit(
  material: MaterialCostingContext,
  price: ApprovedPriceContext
): MaterialCostingUnit | null {
  return material.costingUnit ?? legacyCostingUnit(material, price);
}

function normalisedCostInput(
  material: MaterialCostingContext,
  price: ApprovedPriceContext
): NormalisedCostInput {
  return {
    price: price.price,
    priceUnit: price.priceUnit,
    widthMm: material.purchaseWidthMm,
    heightMm: material.purchaseHeightMm,
    lengthMm: material.purchaseLengthMm,
  };
}

export type CatalogueConsumptionQuote = {
  costBasis: "consumption";
  rate: number;
  purchaseUnit: string;
  inheritDimensions: false;
  inheritQuantity: boolean;
  quantity: string;
};

export type CatalogueAreaQuote = {
  costBasis: "area";
  rate: number;
  purchaseUnit: string;
  inheritDimensions: true;
  inheritQuantity: true;
  quantity: string;
};

export type CatalogueQuoteDefaults =
  | CatalogueConsumptionQuote
  | CatalogueAreaQuote
  | { costBasis: "manual" };

export function catalogueQuoteDefaults(
  material: MaterialCostingContext,
  price: ApprovedPriceContext
): CatalogueQuoteDefaults {
  const unit = resolvedCostingUnit(material, price);

  if (unit == null || !(price.price > 0)) {
    return { costBasis: "manual" };
  }

  if (unit === "square_metre" || unit === "linear_metre") {
    const rate = calculateCostPerSquareMetre(normalisedCostInput(material, price));

    if (rate == null) {
      return { costBasis: "manual" };
    }

    return {
      costBasis: "area",
      rate,
      purchaseUnit: unit === "linear_metre" ? "linear_metre" : "square_metre",
      inheritDimensions: true,
      inheritQuantity: true,
      quantity: "",
    };
  }

  if (unit === "sheet") {
    return {
      costBasis: "consumption",
      rate: price.price,
      purchaseUnit: "sheet",
      inheritDimensions: false,
      inheritQuantity: false,
      quantity: "",
    };
  }

  if (unit === "litre") {
    const rate = calculateCostPerLitre(price.price, material.inkVolumeLitres);

    if (rate == null) {
      return { costBasis: "manual" };
    }

    return {
      costBasis: "consumption",
      rate,
      purchaseUnit: "litre",
      inheritDimensions: false,
      inheritQuantity: true,
      quantity: "",
    };
  }

  if (unit === "each") {
    let rate = price.price;

    if (
      price.priceUnit === "pack" &&
      material.costingPackQuantity != null &&
      material.costingPackQuantity > 0
    ) {
      rate = price.price / material.costingPackQuantity;
    }

    return {
      costBasis: "consumption",
      rate,
      purchaseUnit: "unit",
      inheritDimensions: false,
      inheritQuantity: false,
      quantity: "1",
    };
  }

  if (unit === "pack") {
    return {
      costBasis: "consumption",
      rate: price.price,
      purchaseUnit: "pack",
      inheritDimensions: false,
      inheritQuantity: false,
      quantity: "1",
    };
  }

  return { costBasis: "manual" };
}

/**
 * When invoice lines use pack/box units but the catalogue is per sheet,
 * flag totals that look like a full pack was approved as a single sheet price.
 */
export function invoicePackSheetUnitPriceWarning(input: {
  costingUnit: MaterialCostingUnit | null;
  packQuantity: number | null;
  invoiceUnit: PurchaseUnit | null;
  invoiceUnitPrice: number | null;
  approvedUnitPrice: number;
  tolerance?: number;
}): string | null {
  if (input.costingUnit !== "sheet" || input.packQuantity == null || input.packQuantity <= 1) {
    return null;
  }

  if (input.invoiceUnit !== "pack" && input.invoiceUnit !== "unit") {
    return null;
  }

  if (input.invoiceUnitPrice == null || !(input.invoiceUnitPrice > 0)) {
    return null;
  }

  const tolerance = input.tolerance ?? 0.02;
  const expectedPack = input.approvedUnitPrice * input.packQuantity;
  const mistakenUnit = input.invoiceUnitPrice;
  const looksLikePackTotal = Math.abs(mistakenUnit - expectedPack) <= tolerance;
  const notPerSheet = Math.abs(mistakenUnit - input.approvedUnitPrice) > tolerance;

  if (looksLikePackTotal && notPerSheet) {
    return `This line looks like a pack price (${input.packQuantity} sheets). The catalogue stores ${input.approvedUnitPrice.toFixed(5)} per sheet, not per pack.`;
  }

  return null;
}
