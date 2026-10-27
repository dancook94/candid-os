import { normalizeSupplierDescription } from "@/lib/materials/identity";
import { materialFamiliesConflict, statedAdhesive } from "@/lib/materials/invoices/material-family";
import { normalizePurchaseUnit, reliableSheetSize } from "@/lib/materials/invoices/match";
import type {
  DescriptionMappingRef,
  InvoiceMatchProduct,
  MatchConfidence,
  MatchMethod,
} from "@/lib/materials/invoices/model";

const PROVEN_METHODS = new Set<MatchMethod>(["description", "mapping"]);

export type SupplierSkuRefusal =
  | "ignored"
  | "sku"
  | "match"
  | "product"
  | "supplier"
  | "description"
  | "mapping"
  | "specification"
  | "unit"
  | "duplicate";

export type SupplierSkuSuggestion =
  | { ok: true; sku: string }
  | { ok: false; code: SupplierSkuRefusal };

export function supplierSkuSuggestion(input: {
  processingStatus: string | null;
  supplierId: string | null;
  description: string;
  rawSupplierSku: string | null;
  unit: string | null;
  matchConfidence: MatchConfidence | null;
  matchMethod: MatchMethod | null;
  matchedProductId: string | null;
  product: InvoiceMatchProduct | null;
  supplierProducts: readonly InvoiceMatchProduct[];
  mappings: readonly DescriptionMappingRef[];
}): SupplierSkuSuggestion {
  const sku = catalogueSku(input.rawSupplierSku);
  const product = input.product;

  if (input.processingStatus === "ignored") {
    return { ok: false, code: "ignored" };
  }

  if (!sku) {
    return { ok: false, code: "sku" };
  }

  if (
    input.matchConfidence !== "high" ||
    !input.matchMethod ||
    !PROVEN_METHODS.has(input.matchMethod) ||
    !input.matchedProductId ||
    !product ||
    product.id !== input.matchedProductId
  ) {
    return { ok: false, code: "match" };
  }

  if (!input.supplierId || product.supplierId !== input.supplierId) {
    return { ok: false, code: "supplier" };
  }

  if (catalogueSku(product.sku)) {
    return { ok: false, code: "product" };
  }

  const unit = normalizePurchaseUnit(input.unit);

  if (!unit || unit !== product.purchaseUnit) {
    return { ok: false, code: "unit" };
  }

  const supplierProducts = input.supplierProducts.filter(
    (item) => item.supplierId === input.supplierId
  );
  const description = normalizeSupplierDescription(input.description);

  if (input.matchMethod === "mapping") {
    const mapped = input.mappings.some(
      (mapping) =>
        mapping.supplierId === input.supplierId &&
        mapping.normalizedDescription === description &&
        mapping.productId === product.id
    );

    if (!mapped) {
      return { ok: false, code: "mapping" };
    }
  } else {
    const sameDescription = supplierProducts.filter(
      (item) => normalizeSupplierDescription(item.description) === description
    );

    if (
      sameDescription.length !== 1 ||
      sameDescription[0]?.id !== product.id ||
      normalizeSupplierDescription(product.description) !== description
    ) {
      return { ok: false, code: "description" };
    }
  }

  if (productDetailsConflict(input.description, product)) {
    return { ok: false, code: "specification" };
  }

  const sameSku = supplierProducts.filter(
    (item) => catalogueSku(item.sku)?.toLowerCase() === sku.toLowerCase()
  );

  if (sameSku.length > 0) {
    return { ok: false, code: "duplicate" };
  }

  return { ok: true, sku };
}

export function supplierSkuReviewState(input: {
  processingStatus: string | null;
  approvedSku: string | null;
  suggestedSku: string | null;
}) {
  const approvedSku = catalogueSku(input.approvedSku);

  if (input.processingStatus === "ignored" || approvedSku) {
    return { approvedSku, suggestedSku: null };
  }

  return {
    approvedSku: null,
    suggestedSku: catalogueSku(input.suggestedSku),
  };
}

export function catalogueSku(value: string | null | undefined) {
  const sku = value?.trim().replace(/\s+/g, " ") ?? "";
  return sku.length > 0 ? sku : null;
}

function productDetailsConflict(description: string, product: InvoiceMatchProduct) {
  const productText = `${product.materialName} ${product.description}`;

  if (materialFamiliesConflict(description, productText) || gradesConflict(description, productText)) {
    return true;
  }

  if (slitWidthConflicts(description, product.widthMm)) {
    return true;
  }

  const sheet = reliableSheetSize(description);

  if (sheet && product.widthMm != null && product.heightMm != null) {
    const invoiceSize = [Math.round(sheet.widthMm), Math.round(sheet.heightMm)].sort(
      (left, right) => left - right
    );
    const productSize = [Math.round(product.widthMm), Math.round(product.heightMm)].sort(
      (left, right) => left - right
    );

    if (invoiceSize[0] !== productSize[0] || invoiceSize[1] !== productSize[1]) {
      return true;
    }
  }

  const roll = statedRoll(description);

  if (roll) {
    if (product.widthMm != null && Math.round(roll.widthMm) !== Math.round(product.widthMm)) {
      return true;
    }

    if (product.lengthMm != null && Math.abs(roll.lengthMm - product.lengthMm) > 1) {
      return true;
    }
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

function statedRoll(description: string) {
  const sizes = [
    ...[...description.matchAll(/(\d+(?:\.\d+)?)\s*mm\s*[x×]\s*(\d+(?:\.\d+)?)\s*m\b/gi)].map(
      (match) => ({ widthMm: Number(match[1]), lengthMm: Number(match[2]) * 1000 })
    ),
    ...[...description.matchAll(/(\d+(?:\.\d+)?)\s*m\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm\b/gi)].map(
      (match) => ({ widthMm: Number(match[2]), lengthMm: Number(match[1]) * 1000 })
    ),
  ].filter((size) => size.widthMm > 0 && size.lengthMm > 0);
  const unique = sizes.filter(
    (size, index) =>
      sizes.findIndex(
        (item) =>
          Math.round(item.widthMm) === Math.round(size.widthMm) &&
          Math.round(item.lengthMm) === Math.round(size.lengthMm)
      ) === index
  );

  return unique.length === 1 ? unique[0] : null;
}

function slitWidthConflicts(description: string, widthMm: number | null) {
  if (widthMm == null) {
    return false;
  }

  const width = Math.round(widthMm);
  const slits = [...description.matchAll(/\bslit to\s+(\d{3,4}(?:\.\d+)?)\s*mm\b/gi)]
    .map((match) => Math.round(Number(match[1])))
    .filter((value) => Number.isFinite(value));

  return slits.some((value) => value !== width);
}

function gradesConflict(invoiceText: string, productText: string) {
  const invoiceGrades = gradeTokens(invoiceText);
  const productGrades = gradeTokens(productText);

  if (invoiceGrades.size === 0 || productGrades.size === 0) {
    return false;
  }

  for (const grade of invoiceGrades) {
    if (productGrades.has(grade)) {
      return false;
    }
  }

  return true;
}

function gradeTokens(text: string) {
  const tokens = new Set<string>();

  for (const match of text.matchAll(/\bPQ\s*([0-9]+)\b/gi)) {
    tokens.add(`pq${match[1]}`);
  }

  for (const match of text.matchAll(/\bFG-([0-9]+)\b/gi)) {
    tokens.add(`fg-${match[1]}`);
  }

  return tokens;
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
