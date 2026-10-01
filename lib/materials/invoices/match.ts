import { normalizeSupplierDescription } from "@/lib/materials/identity";
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

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "mm",
  "gsm",
  "sheet",
  "roll",
  "pack",
  "white",
]);

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
    : findMatch(identity, normalized, input.supplierId, supplierProducts, input.mappings);
  const purchaseUnit = normalizePurchaseUnit(identity.unit);
  const product = supplierProducts.find((item) => item.id === match.productId) ?? null;
  const comparison =
    product &&
    product.currentPrice != null &&
    product.currentPriceUnit &&
    identity.unitPrice != null &&
    purchaseUnit === product.currentPriceUnit
      ? compareApprovedPrice(
          product.currentPrice,
          identity.unitPrice,
          product.currentPriceUnit
        )
      : null;

  let reviewStatus: InvoiceReviewStatus = "unmatched";
  let note: string | null = match.note;

  if (!input.supplierId) {
    reviewStatus = "needs_review";
    note = "Choose the supplier before this line can be matched.";
  } else if (mathsWarning) {
    reviewStatus = "extraction_error";
  } else if (!match.productId || !match.confidence) {
    reviewStatus = "unmatched";
  } else if (match.confidence !== "high") {
    reviewStatus = "needs_review";
  } else if (!purchaseUnit) {
    reviewStatus = "needs_review";
    note = "The purchase unit was not extracted, so the price was not treated as matched.";
  } else if (!product || comparison == null) {
    reviewStatus = "needs_review";
    note = "This product has no current approved price in the same unit.";
  } else if (purchaseUnit !== product.purchaseUnit) {
    reviewStatus = "needs_review";
    note = "The invoice unit does not match the material purchase unit.";
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
    const skuMatch = products.find((product) => product.sku?.trim().toLowerCase() === sku);

    if (skuMatch) {
      return {
        productId: skuMatch.id,
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

  if (descriptionMatch) {
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

  const specification = bestSpecification(identity.description, products);

  if (specification.status === "unique") {
    return {
      productId: specification.productId,
      confidence: "medium",
      method: "specification",
      note: null,
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

  const fuzzy = bestFuzzy(identity.description, products);

  if (fuzzy.status === "unique") {
    return {
      productId: fuzzy.productId,
      confidence: "low",
      method: "fuzzy",
      note: null,
    };
  }

  return { productId: null, confidence: null, method: null, note: null };
}

function bestSpecification(description: string, products: readonly InvoiceMatchProduct[]) {
  const scored = products
    .map((product) => ({ product, score: specificationScore(description, product) }))
    .filter((item) => item.score >= 4)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return { status: "none" as const, productId: null };
  }

  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { status: "ambiguous" as const, productId: null };
  }

  return { status: "unique" as const, productId: scored[0].product.id };
}

function specificationScore(description: string, product: InvoiceMatchProduct) {
  let score = 0;
  const dimensions = extractDimensions(description);
  const thickness = extractThickness(description);
  const colour = extractColour(description);
  const shared = sharedTokens(description, `${product.materialName} ${product.description}`);

  if (
    dimensions &&
    sameDimensions(dimensions, product.widthMm, product.heightMm)
  ) {
    score += 2;
  }

  if (
    thickness != null &&
    product.thicknessMm != null &&
    Math.abs(thickness - product.thicknessMm) < 0.15
  ) {
    score += 2;
  }

  if (colour && product.colour && colour === product.colour.toLowerCase()) {
    score += 1;
  }

  if (shared >= 1) {
    score += 1;
  }

  return score;
}

function bestFuzzy(description: string, products: readonly InvoiceMatchProduct[]) {
  const scored = products
    .map((product) => ({
      product,
      shared: sharedTokens(description, `${product.materialName} ${product.description}`),
    }))
    .filter((item) => item.shared >= 2)
    .sort((left, right) => right.shared - left.shared);

  if (scored.length === 0) {
    return { status: "none" as const, productId: null };
  }

  if (scored.length > 1 && scored[0].shared === scored[1].shared) {
    return { status: "ambiguous" as const, productId: null };
  }

  return { status: "unique" as const, productId: scored[0].product.id };
}

function extractDimensions(description: string) {
  const match = description.match(
    /(\d{3,4}(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d{3,4}(?:\.\d+)?)\s*(?:mm)?/i
  );

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

function sharedTokens(left: string, right: string) {
  const rightTokens = tokens(right);
  let count = 0;

  for (const token of tokens(left)) {
    if (rightTokens.has(token)) {
      count += 1;
    }
  }

  return count;
}

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token) && !/^\d+$/.test(token))
  );
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
