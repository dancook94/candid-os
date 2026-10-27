import { normalizeSupplierDescription } from "@/lib/materials/identity";
import { materialFamiliesConflict, statedAdhesive } from "@/lib/materials/invoices/material-family";
import {
  invoiceWidthConflicts,
  normalizePurchaseUnit,
  reliableRollSize,
  reliableSheetSize,
} from "@/lib/materials/invoices/match";
import { moneyMatches, roundMoney } from "@/lib/materials/invoices/money";
import type {
  ClassifiedLine,
  DescriptionMappingRef,
  InvoiceExtractionStatus,
  InvoiceMatchProduct,
} from "@/lib/materials/invoices/model";
import type { ApprovedPriceRecord } from "@/lib/materials/pricing";

export const HISTORICAL_PRICE_RULE = "historical_price";

export const HISTORICAL_PRICE_REASON =
  "The invoice date is before the current approved price effective date, so the current price was retained.";

export type HistoricalPriceRefusal =
  | "extraction"
  | "match"
  | "sku"
  | "description"
  | "specification"
  | "unit"
  | "date"
  | "price"
  | "tie"
  | "supplier"
  | "active"
  | "equal";

export type HistoricalPriceRetention = {
  retain: true;
  rule: typeof HISTORICAL_PRICE_RULE;
  reason: typeof HISTORICAL_PRICE_REASON;
  priceId: string;
  productId: string;
  supplierId: string;
  invoicePrice: number;
  currentPrice: number;
  effectiveDate: string;
  invoiceDate: string;
};

export type HistoricalPriceDecision =
  | HistoricalPriceRetention
  | { retain: false; code: HistoricalPriceRefusal };

const PROVEN_MATCH_METHODS = new Set(["sku", "description", "mapping"]);

export function historicalPriceDecision(input: {
  extractionStatus: InvoiceExtractionStatus;
  invoiceDate: string | null;
  supplierId: string | null;
  line: ClassifiedLine;
  product: InvoiceMatchProduct | null;
  productActive: boolean;
  supplierProducts: readonly InvoiceMatchProduct[];
  mappings: readonly DescriptionMappingRef[];
  prices: readonly ApprovedPriceRecord[];
}): HistoricalPriceDecision {
  const product = input.product;
  const supplierId = input.supplierId;

  if (input.extractionStatus !== "extracted" || input.line.mathsWarning) {
    return { retain: false, code: "extraction" };
  }

  if (!supplierId || !product || product.supplierId !== supplierId) {
    return { retain: false, code: "supplier" };
  }

  if (!input.productActive) {
    return { retain: false, code: "active" };
  }

  if (
    input.line.matchConfidence !== "high" ||
    !input.line.matchMethod ||
    !PROVEN_MATCH_METHODS.has(input.line.matchMethod) ||
    input.line.matchedProductId !== product.id
  ) {
    return { retain: false, code: "match" };
  }

  const identification = provenIdentification({
    method: input.line.matchMethod,
    line: input.line,
    product,
    supplierId,
    supplierProducts: input.supplierProducts,
    mappings: input.mappings,
  });

  if (!identification.ok) {
    return { retain: false, code: identification.code };
  }

  if (specificationConflict(input.line.rawDescription, product)) {
    return { retain: false, code: "specification" };
  }

  const unit = normalizePurchaseUnit(input.line.rawUnit);

  if (!unit || unit !== product.purchaseUnit) {
    return { retain: false, code: "unit" };
  }

  const invoiceDate = calendarDate(input.invoiceDate);
  const prices = input.prices.filter((price) => price.priceUnit === unit);

  if (!invoiceDate) {
    return { retain: false, code: "date" };
  }

  if (
    prices.length === 0 ||
    product.currentPrice == null ||
    product.currentPriceUnit == null ||
    !product.currentPriceId ||
    !product.currentEffectiveDate
  ) {
    return { retain: false, code: "price" };
  }

  if (unit !== product.currentPriceUnit) {
    return { retain: false, code: "unit" };
  }

  const latestDate = prices.reduce(
    (latest, price) => (price.effectiveDate > latest ? price.effectiveDate : latest),
    prices[0].effectiveDate
  );
  const atLatest = prices.filter((price) => price.effectiveDate === latestDate);

  if (atLatest.length !== 1) {
    return { retain: false, code: "tie" };
  }

  const current = atLatest[0];

  if (
    current.id !== product.currentPriceId ||
    current.effectiveDate !== product.currentEffectiveDate ||
    !moneyMatches(current.price, product.currentPrice)
  ) {
    return { retain: false, code: "price" };
  }

  if (!calendarDate(current.effectiveDate) || invoiceDate >= current.effectiveDate) {
    return { retain: false, code: "date" };
  }

  const invoicePrice = roundMoney(input.line.comparison?.invoicePrice ?? input.line.rawUnitPrice ?? Number.NaN);

  if (!Number.isFinite(invoicePrice) || invoicePrice <= 0) {
    return { retain: false, code: "price" };
  }

  if (moneyMatches(current.price, invoicePrice)) {
    return { retain: false, code: "equal" };
  }

  return {
    retain: true,
    rule: HISTORICAL_PRICE_RULE,
    reason: HISTORICAL_PRICE_REASON,
    priceId: current.id,
    productId: product.id,
    supplierId,
    invoicePrice,
    currentPrice: roundMoney(current.price),
    effectiveDate: current.effectiveDate,
    invoiceDate,
  };
}

function provenIdentification(input: {
  method: string;
  line: ClassifiedLine;
  product: InvoiceMatchProduct;
  supplierId: string;
  supplierProducts: readonly InvoiceMatchProduct[];
  mappings: readonly DescriptionMappingRef[];
}): { ok: true } | { ok: false; code: "sku" | "description" | "match" } {
  const productSku = normalizeSku(input.product.sku);
  const invoiceSku = normalizeSku(input.line.rawSupplierSku);
  const description = normalizeSupplierDescription(input.line.rawDescription);

  if (input.method === "mapping") {
    const mapped = input.mappings.some(
      (mapping) =>
        mapping.supplierId === input.supplierId &&
        mapping.normalizedDescription === description &&
        mapping.productId === input.product.id
    );

    if (!mapped) {
      return { ok: false, code: "match" };
    }

    if (productSku && invoiceSku && productSku !== invoiceSku) {
      return { ok: false, code: "sku" };
    }

    return { ok: true };
  }

  if (!productSku || !invoiceSku || productSku !== invoiceSku) {
    return { ok: false, code: "sku" };
  }

  const sameSku = input.supplierProducts.filter((product) => normalizeSku(product.sku) === invoiceSku);

  if (sameSku.length !== 1 || sameSku[0]?.id !== input.product.id) {
    return { ok: false, code: "sku" };
  }

  const sameDescription = input.supplierProducts.filter(
    (product) => normalizeSupplierDescription(product.description) === description
  );

  if (sameDescription.length !== 1 || sameDescription[0]?.id !== input.product.id) {
    return { ok: false, code: "description" };
  }

  return { ok: true };
}

function specificationConflict(description: string, product: InvoiceMatchProduct) {
  const productText = `${product.materialName} ${product.description}`;

  if (materialFamiliesConflict(description, productText) || invoiceWidthConflicts(description, product)) {
    return true;
  }

  const sheet = reliableSheetSize(description);

  if (sheet && product.widthMm != null && product.heightMm != null) {
    const invoiceSize = [Math.round(sheet.widthMm), Math.round(sheet.heightMm)].sort((left, right) => left - right);
    const productSize = [Math.round(product.widthMm), Math.round(product.heightMm)].sort((left, right) => left - right);

    if (invoiceSize[0] !== productSize[0] || invoiceSize[1] !== productSize[1]) {
      return true;
    }
  }

  const roll = reliableRollSize(description);

  if (roll && product.lengthMm != null && Math.abs(roll.lengthMm - product.lengthMm) > 1) {
    return true;
  }

  const invoiceAdhesive = statedAdhesive(description);
  const productAdhesive = statedAdhesive(productText);

  if (invoiceAdhesive && productAdhesive && invoiceAdhesive !== productAdhesive) {
    return true;
  }

  const thickness = statedThickness(description);

  return (
    thickness != null &&
    product.thicknessMm != null &&
    Math.abs(thickness - product.thicknessMm) >= 0.15
  );
}

function statedThickness(description: string) {
  const withoutSheetSize = description.replace(
    /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm)?/gi,
    " "
  );
  const match = withoutSheetSize.match(/(\d+(?:\.\d+)?)\s*mm/i);

  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return value > 0 && value <= 100 ? value : null;
}

function normalizeSku(value: string | null | undefined) {
  const sku = value?.trim().toLowerCase() ?? "";
  return sku.length > 0 ? sku : null;
}

function calendarDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return value;
}
