import {
  catalogueQuoteDefaults,
  type MaterialCostingContext,
} from "@/lib/materials/costing-unit";
import type { PurchaseUnit } from "@/lib/materials/units";
import { roundRate } from "@/lib/quotes/costing";
import type { QuoteMaterialComponentDraft } from "@/lib/quotes/costing";
import { emptyMaterialComponent } from "@/lib/quotes/costing";

export type CatalogQuoteMaterial = MaterialCostingContext & {
  id: string;
  name: string;
};

export type CatalogQuoteProduct = {
  id: string;
  supplierName: string;
  currentPriceId: string | null;
  currentPrice: number | null;
  currentPriceUnit: PurchaseUnit | null;
};

export function draftFromApprovedCatalogProduct(
  material: CatalogQuoteMaterial,
  product: CatalogQuoteProduct
): QuoteMaterialComponentDraft {
  const base = {
    sourceKind: "approved_material" as const,
    materialId: material.id,
    productId: product.id,
    priceId: product.currentPriceId,
    materialName: material.name,
    supplierName: product.supplierName,
    purchaseUnit: product.currentPriceUnit ?? "",
    refreshRate: true,
    rateSource: "current" as const,
  };

  if (product.currentPrice == null || product.currentPriceUnit == null) {
    return emptyMaterialComponent({
      ...base,
      costBasis: "manual",
      pricingSource: "manual",
      refreshRate: false,
      rate: "",
      rateSource: "saved",
      inheritDimensions: false,
      inheritQuantity: false,
    });
  }

  const defaults = catalogueQuoteDefaults(material, {
    price: product.currentPrice,
    priceUnit: product.currentPriceUnit,
  });

  if (defaults.costBasis === "manual") {
    return emptyMaterialComponent({
      ...base,
      costBasis: "manual",
      pricingSource: "manual",
      refreshRate: false,
      rate: "",
      rateSource: "saved",
      inheritDimensions: false,
      inheritQuantity: false,
    });
  }

  if (defaults.costBasis === "area") {
    return emptyMaterialComponent({
      ...base,
      costBasis: "area",
      pricingSource: "catalogue",
      rate: String(roundRate(defaults.rate)),
      purchaseUnit: defaults.purchaseUnit,
      inheritDimensions: defaults.inheritDimensions,
      inheritQuantity: defaults.inheritQuantity,
      quantity: defaults.quantity,
    });
  }

  return emptyMaterialComponent({
    ...base,
    costBasis: "consumption",
    pricingSource: "catalogue",
    rate: String(roundRate(defaults.rate)),
    purchaseUnit: defaults.purchaseUnit,
    inheritDimensions: defaults.inheritDimensions,
    inheritQuantity: defaults.inheritQuantity,
    quantity: defaults.quantity,
  });
}
