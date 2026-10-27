import { normalizeSupplierDescription } from "@/lib/materials/identity";
import {
  materialFamilies,
  materialFamiliesConflict,
  statedAdhesive,
} from "@/lib/materials/invoices/material-family";
import { isPurchaseUnit, type PurchaseUnit } from "@/lib/materials/units";

import {
  compareApprovedPrice,
  lineMathsWarning,
  moneyMatches,
} from "@/lib/materials/invoices/money";
import type {
  ClassifiedLine,
  DescriptionMappingRef,
  IgnoreRuleRef,
  InvoiceMatchProduct,
  InvoiceProcessingStatus,
  InvoiceReviewStatus,
  MatchConfidence,
  MatchMethod,
  ParsedInvoiceLine,
} from "@/lib/materials/invoices/model";

const UNIT_TO_PURCHASE: Record<string, PurchaseUnit> = {
  sheet: "sheet",
  sheets: "sheet",
  roll: "roll",
  rolls: "roll",
  m: "linear_metre",
  metre: "linear_metre",
  metres: "linear_metre",
  meter: "linear_metre",
  meters: "linear_metre",
  "linear metre": "linear_metre",
  "linear metres": "linear_metre",
  each: "unit",
  unit: "unit",
  units: "unit",
  pack: "pack",
  packs: "pack",
  box: "pack",
  boxes: "pack",
};

const COLOURS = [
  "white",
  "black",
  "clear",
  "silver",
  "grey",
  "gray",
  "brown",
  "blue",
  "red",
  "green",
  "yellow",
];

type LineIdentity = {
  description: string;
  sku: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
};

export function classifyInvoiceLine(input: {
  line: ParsedInvoiceLine;
  supplierId: string | null;
  products: readonly InvoiceMatchProduct[];
  mappings: readonly DescriptionMappingRef[];
  ignoreRules: readonly IgnoreRuleRef[];
  forcedProductId?: string | null;
  forcedMethod?: MatchMethod;
  description?: string | null;
  sku?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
}): ClassifiedLine {
  const identity: LineIdentity = {
    description: input.description ?? input.line.rawDescription,
    sku: input.sku === undefined ? input.line.rawSupplierSku : input.sku,
    quantity: input.quantity === undefined ? input.line.rawQuantity : input.quantity,
    unit: input.unit === undefined ? input.line.rawUnit : input.unit,
    unitPrice: input.unitPrice === undefined ? input.line.rawUnitPrice : input.unitPrice,
    lineTotal: input.lineTotal === undefined ? input.line.rawLineTotal : input.lineTotal,
  };
  const mathsWarning = lineMathsWarning(
    identity.quantity,
    identity.unitPrice,
    identity.lineTotal
  );
  const normalized = normalizeSupplierDescription(identity.description);
  const supplierProducts = input.supplierId
    ? input.products.filter((product) => product.supplierId === input.supplierId)
    : [];
  const compatibleProducts = supplierProducts.filter(
    (product) => !invoiceWidthConflicts(identity.description, product)
  );

  if (
    !input.forcedProductId &&
    input.supplierId &&
    input.ignoreRules.some(
      (rule) =>
        rule.supplierId === input.supplierId &&
        rule.normalizedDescription === normalized
    )
  ) {
    return baseLine(input.line, {
      matchedProductId: null,
      matchConfidence: null,
      matchMethod: null,
      reviewStatus: "ignored",
      mathsWarning,
      comparison: null,
      note: null,
    });
  }

  const match = input.forcedProductId
    ? {
        productId: supplierProducts.some((product) => product.id === input.forcedProductId)
          ? input.forcedProductId
          : null,
        confidence: "high" as const,
        method: input.forcedMethod ?? ("manual" as const),
        note: supplierProducts.some((product) => product.id === input.forcedProductId)
          ? null
          : "That supplier product is not sold by this supplier.",
      }
    : findSupplierMatch(
        identity,
        normalized,
        input.supplierId,
        supplierProducts,
        compatibleProducts,
        input.mappings
      );
  const statedUnit = normalizePurchaseUnit(identity.unit);
  const statedUnitText = identity.unit?.trim() ?? "";
  const product = supplierProducts.find((item) => item.id === match.productId) ?? null;
  const catalogueUnit =
    !statedUnitText &&
    match.confidence === "high" &&
    product?.purchaseUnit &&
    product.currentPriceUnit === product.purchaseUnit
      ? product.purchaseUnit
      : null;
  const purchaseUnit = statedUnit ?? catalogueUnit;
  let comparison =
    product &&
    product.currentPrice != null &&
    product.currentPriceUnit &&
    identity.unitPrice != null &&
    purchaseUnit === product.currentPriceUnit
      ? compareApprovedPrice(
          product.currentPrice,
          identity.unitPrice,
          product.currentPriceUnit,
          {
            currentPriceId: product.currentPriceId,
            currentEffectiveDate: product.currentEffectiveDate,
          }
        )
      : null;

  let reviewStatus: InvoiceReviewStatus = "unmatched";
  let note: string | null = match.note;

  if (!input.supplierId) {
    reviewStatus = "needs_review";
    note = "Choose the supplier before this line can be matched.";
  } else if (mathsWarning) {
    reviewStatus = "extraction_error";
  } else if (match.note === WIDTH_CONFLICT_NOTE) {
    reviewStatus = "needs_review";
  } else if (statedUnitText && !statedUnit) {
    reviewStatus = "needs_review";
    note = "The purchase unit was not recognised, so the price was not treated as matched.";
  } else if (!match.productId || !match.confidence) {
    reviewStatus = "unmatched";
  } else if (match.confidence !== "high") {
    reviewStatus = "needs_review";
  } else if (!statedUnit && catalogueUnit && comparison) {
    if (moneyMatches(comparison.currentPrice, comparison.invoicePrice)) {
      reviewStatus = "processed";
      note = "The invoice did not state a purchase unit. The price matches the catalogue unit.";
    } else {
      reviewStatus = "price_change";
      note = "The invoice did not state a purchase unit. The historical price differs from the current catalogue price.";
    }
  } else if (!purchaseUnit) {
    reviewStatus = "needs_review";
    note = "The purchase unit was not extracted, so the price was not treated as matched.";
  } else if (
    product &&
    (purchaseUnit !== product.purchaseUnit ||
      (product.currentPriceUnit != null && purchaseUnit !== product.currentPriceUnit))
  ) {
    reviewStatus = "needs_review";
    note = "The invoice unit does not match the material purchase unit.";
  } else if (!product || comparison == null) {
    reviewStatus = "needs_review";
    note = "This product has no current approved price in the same unit.";
  } else if (moneyMatches(comparison.currentPrice, comparison.invoicePrice)) {
    reviewStatus = "processed";
  } else {
    reviewStatus = "price_change";
  }

  return baseLine(input.line, {
    matchedProductId: match.productId,
    matchConfidence: match.confidence,
    matchMethod: match.method,
    reviewStatus,
    mathsWarning,
    comparison,
    note,
  });
}

export function deriveProcessingStatus(input: {
  extractionStatus: "extracted" | "failed" | "needs_ocr";
  warnings: readonly string[];
  lineStatuses: readonly InvoiceReviewStatus[];
}): InvoiceProcessingStatus {
  if (input.extractionStatus !== "extracted" || input.lineStatuses.length === 0) {
    return "extraction_error";
  }

  if (
    input.lineStatuses.some((status) => status === "extraction_error") ||
    input.warnings.some((warning) => warning.includes("Subtotal") || warning.includes("line totals"))
  ) {
    return "extraction_error";
  }

  if (input.lineStatuses.some((status) => status === "unmatched")) {
    return "unmatched";
  }

  if (
    input.lineStatuses.some(
      (status) => status === "needs_review" || status === "query"
    )
  ) {
    return "needs_review";
  }

  if (input.lineStatuses.some((status) => status === "price_change")) {
    return "price_change";
  }

  if (input.lineStatuses.every((status) => status === "ignored")) {
    return "ignored";
  }

  return "processed";
}

export function normalizePurchaseUnit(value: string | null): PurchaseUnit | null {
  if (!value) {
    return null;
  }

  const mapped = UNIT_TO_PURCHASE[value.trim().toLowerCase()];

  if (mapped) {
    return mapped;
  }

  return isPurchaseUnit(value) ? value : null;
}

const WIDTH_CONFLICT_NOTE = "The invoice width does not match a product from this supplier.";
const SPECIFICATION_NOTE =
  "Uncertain suggestion from the material family and size. It is not an exact supplier SKU match.";

function findSupplierMatch(
  identity: LineIdentity,
  normalizedDescription: string,
  supplierId: string | null,
  supplierProducts: readonly InvoiceMatchProduct[],
  compatibleProducts: readonly InvoiceMatchProduct[],
  mappings: readonly DescriptionMappingRef[]
) {
  const match = findMatch(
    identity,
    normalizedDescription,
    supplierId,
    compatibleProducts,
    mappings
  );

  if (match.productId || match.note || compatibleProducts.length === supplierProducts.length) {
    return match;
  }

  const rejected = findMatch(
    identity,
    normalizedDescription,
    supplierId,
    supplierProducts,
    mappings
  );
  const rejectedProduct = supplierProducts.find((product) => product.id === rejected.productId);

  if (rejectedProduct && invoiceWidthConflicts(identity.description, rejectedProduct)) {
    return {
      productId: null,
      confidence: null,
      method: null,
      note: WIDTH_CONFLICT_NOTE,
    };
  }

  return match;
}

export function invoiceWidthConflicts(description: string, product: InvoiceMatchProduct) {
  if (product.widthMm == null) {
    return false;
  }

  const width = Math.round(product.widthMm);
  const slitWidths = [...description.matchAll(/\bslit to\s+(\d{3,4}(?:\.\d+)?)\s*mm\b/gi)]
    .map((match) => Math.round(Number(match[1])))
    .filter((value) => Number.isFinite(value));

  if (slitWidths.length > 0) {
    return slitWidths.some((value) => value !== width);
  }

  const stated = statedRollWidthMm(description);

  if (stated == null) {
    return false;
  }

  return Math.round(stated) !== width;
}

const SHEET_DIMENSION_SOURCE =
  "(\\d{3,4}(?:\\.\\d+)?)\\s*(?:mm)?\\s*[x×]\\s*(\\d{3,4}(?:\\.\\d+)?)\\s*(?:mm)?";
const ROLL_DIMENSION_SOURCE =
  "(\\d+(?:\\.\\d+)?)\\s*mm\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*m\\b|(\\d+(?:\\.\\d+)?)\\s*m\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*mm\\b";

export function reliableSheetSize(description: string) {
  const pairs = uniquePairs(
    [...description.matchAll(new RegExp(SHEET_DIMENSION_SOURCE, "gi"))]
      .filter((match) => /mm/i.test(match[0]))
      .map((match) => [Number(match[1]), Number(match[2])] as const)
  );

  if (pairs.length !== 1) {
    return null;
  }

  return { widthMm: pairs[0][0], heightMm: pairs[0][1] };
}

export function reliableRollSize(description: string) {
  const sizes = rollSizes(description);

  return sizes.length === 1 ? sizes[0] : null;
}

function rollSizes(description: string) {
  return uniquePairs(
    [...description.matchAll(new RegExp(ROLL_DIMENSION_SOURCE, "gi"))].map((match) =>
      match[1] != null
        ? ([Number(match[1]), Number(match[2]) * 1000] as const)
        : ([Number(match[4]), Number(match[3]) * 1000] as const)
    )
  ).map(([widthMm, lengthMm]) => ({
    widthMm,
    lengthMm,
    lengthMetres: lengthMm / 1000,
  }));
}

function uniquePairs(pairs: readonly (readonly [number, number])[]) {
  const unique: Array<readonly [number, number]> = [];

  for (const pair of pairs) {
    if (!pair.every((value) => Number.isFinite(value) && value > 0)) {
      continue;
    }

    const key = pair.map((value) => Math.round(value)).join(":");

    if (!unique.some((item) => item.map((value) => Math.round(value)).join(":") === key)) {
      unique.push(pair);
    }
  }

  return unique;
}

function statedRollWidthMm(description: string) {
  return rollSizes(description)[0]?.widthMm ?? null;
}

function statedRollLengthMm(description: string) {
  return rollSizes(description)[0]?.lengthMm ?? null;
}

function findMatch(
  identity: LineIdentity,
  normalizedDescription: string,
  supplierId: string | null,
  products: readonly InvoiceMatchProduct[],
  mappings: readonly DescriptionMappingRef[]
): {
  productId: string | null;
  confidence: MatchConfidence | null;
  method: MatchMethod | null;
  note: string | null;
} {
  if (!supplierId) {
    return { productId: null, confidence: null, method: null, note: null };
  }

  const sku = identity.sku?.trim().toLowerCase();

  if (sku) {
    const skuMatches = products.filter((product) => product.sku?.trim().toLowerCase() === sku);

    if (skuMatches.length > 1) {
      return {
        productId: null,
        confidence: null,
        method: null,
        note: "Several products from this supplier use this SKU.",
      };
    }

    if (skuMatches.length === 1) {
      return {
        productId: skuMatches[0].id,
        confidence: "high",
        method: "sku",
        note: null,
      };
    }
  }

  const descriptionMatch = products.find(
    (product) =>
      normalizeSupplierDescription(product.description) === normalizedDescription
  );

  if (
    descriptionMatch &&
    !skusConflict(identity.sku, descriptionMatch.sku) &&
    !materialFamiliesConflict(
      identity.description,
      `${descriptionMatch.materialName} ${descriptionMatch.description}`
    )
  ) {
    return {
      productId: descriptionMatch.id,
      confidence: "high",
      method: "description",
      note: null,
    };
  }

  const mapping = mappings.find(
    (item) =>
      item.supplierId === supplierId &&
      item.normalizedDescription === normalizedDescription
  );
  const mappedProduct = products.find((product) => product.id === mapping?.productId);

  if (mappedProduct) {
    return {
      productId: mappedProduct.id,
      confidence: "high",
      method: "mapping",
      note: null,
    };
  }

  const specification = bestSpecification(identity, products);

  if (specification.status === "unique") {
    return {
      productId: specification.productId,
      confidence: "medium",
      method: "specification",
      note: SPECIFICATION_NOTE,
    };
  }

  if (specification.status === "ambiguous") {
    return {
      productId: null,
      confidence: null,
      method: null,
      note: "Several products from this supplier have a similar size and description.",
    };
  }

  return { productId: null, confidence: null, method: null, note: null };
}

function skusConflict(invoiceSku: string | null, productSku: string | null) {
  if (!invoiceSku?.trim() || !productSku?.trim()) {
    return false;
  }

  return invoiceSku.trim().toLowerCase() !== productSku.trim().toLowerCase();
}

function bestSpecification(identity: LineIdentity, products: readonly InvoiceMatchProduct[]) {
  const matched = products.filter((product) => specificationCompatible(identity, product));

  if (matched.length === 0) {
    return { status: "none" as const, productId: null };
  }

  if (matched.length > 1) {
    return { status: "ambiguous" as const, productId: null };
  }

  return { status: "unique" as const, productId: matched[0].id };
}

function specificationCompatible(identity: LineIdentity, product: InvoiceMatchProduct) {
  const productText = `${product.materialName} ${product.description}`;
  const invoiceFamilies = materialFamilies(identity.description);
  const productFamilies = materialFamilies(productText);

  if (
    invoiceFamilies.length !== 1 ||
    productFamilies.length !== 1 ||
    invoiceFamilies[0] !== productFamilies[0]
  ) {
    return false;
  }

  const unit = normalizePurchaseUnit(identity.unit);

  if (unit && unit !== product.purchaseUnit) {
    return false;
  }

  if (statedAdhesive(identity.description) !== statedAdhesive(productText)) {
    return false;
  }

  const thickness = extractThickness(identity.description);

  if (product.purchaseUnit === "sheet" || thickness != null) {
    if (
      thickness == null ||
      product.thicknessMm == null ||
      Math.abs(thickness - product.thicknessMm) >= 0.15
    ) {
      return false;
    }
  }

  const dimensions = extractDimensions(identity.description);

  if (dimensions) {
    if (!sameDimensions(dimensions, product.widthMm, product.heightMm)) {
      return false;
    }
  } else {
    const width = statedRollWidthMm(identity.description);
    const length = statedRollLengthMm(identity.description);

    if (
      width == null ||
      length == null ||
      product.widthMm == null ||
      product.lengthMm == null ||
      Math.round(width) !== Math.round(product.widthMm) ||
      Math.abs(length - product.lengthMm) > 1
    ) {
      return false;
    }
  }

  const colour = extractColour(identity.description);

  if (!colour || !product.colour || canonicalColour(colour) !== canonicalColour(product.colour)) {
    return false;
  }

  return true;
}

function extractDimensions(description: string) {
  const match = description.match(new RegExp(SHEET_DIMENSION_SOURCE, "i"));

  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2])] as const;
}

function sameDimensions(
  pair: readonly [number, number],
  width: number | null,
  height: number | null
) {
  if (width == null || height == null) {
    return false;
  }

  const left = [Math.round(pair[0]), Math.round(pair[1])].sort((a, b) => a - b);
  const right = [Math.round(width), Math.round(height)].sort((a, b) => a - b);
  return left[0] === right[0] && left[1] === right[1];
}

function extractThickness(description: string) {
  const withoutDimensions = description.replace(
    /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm)?/gi,
    " "
  );
  const match = withoutDimensions.match(/(\d+(?:\.\d+)?)\s*mm/i);

  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return value > 0 && value <= 100 ? value : null;
}

function extractColour(description: string) {
  const lower = description.toLowerCase();
  return COLOURS.find((colour) => lower.includes(colour)) ?? null;
}

function canonicalColour(value: string) {
  const colour = value.toLowerCase();
  return colour === "gray" ? "grey" : colour;
}

function baseLine(
  line: ParsedInvoiceLine,
  result: Omit<
    ClassifiedLine,
    | "lineNumber"
    | "rawDescription"
    | "rawSupplierSku"
    | "rawQuantity"
    | "rawUnit"
    | "rawUnitPrice"
    | "rawLineTotal"
    | "rawTax"
  >
): ClassifiedLine {
  return {
    lineNumber: line.lineNumber,
    rawDescription: line.rawDescription,
    rawSupplierSku: line.rawSupplierSku,
    rawQuantity: line.rawQuantity,
    rawUnit: line.rawUnit,
    rawUnitPrice: line.rawUnitPrice,
    rawLineTotal: line.rawLineTotal,
    rawTax: line.rawTax,
    ...result,
    note: result.note,
    matchedProductId: result.matchedProductId,
    comparison: result.comparison,
  };
}

export function effectiveLineIdentity(line: {
  rawDescription: string;
  rawSupplierSku: string | null;
  rawQuantity: number | null;
  rawUnit: string | null;
  rawUnitPrice: number | null;
  rawLineTotal: number | null;
  reviewedDescription?: string | null;
  reviewedSupplierSku?: string | null;
  reviewedQuantity?: number | null;
  reviewedUnit?: string | null;
  reviewedUnitPrice?: number | null;
  reviewedLineTotal?: number | null;
}): LineIdentity {
  return {
    description: line.reviewedDescription ?? line.rawDescription,
    sku: line.reviewedSupplierSku ?? line.rawSupplierSku,
    quantity: line.reviewedQuantity ?? line.rawQuantity,
    unit: line.reviewedUnit ?? line.rawUnit,
    unitPrice: line.reviewedUnitPrice ?? line.rawUnitPrice,
    lineTotal: line.reviewedLineTotal ?? line.rawLineTotal,
  };
}
