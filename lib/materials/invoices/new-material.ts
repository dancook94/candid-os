import { buildMaterialIdentityKey, normalizeSupplierDescription } from "@/lib/materials/identity";
import { normalizePurchaseUnit } from "@/lib/materials/invoices/match";
import type { InvoiceReviewStatus } from "@/lib/materials/invoices/model";
import type { PurchaseUnit } from "@/lib/materials/units";

export type InvoiceMaterialDraft = {
  name: string;
  category: string | null;
  thicknessMm: number | null;
  colour: string | null;
  finish: string | null;
  purchaseUnit: PurchaseUnit | null;
  purchaseWidthMm: number | null;
  purchaseHeightMm: number | null;
  purchaseLengthMm: number | null;
  supplierDescription: string;
  supplierSku: string | null;
  price: number | null;
  preferred: boolean;
  notes: string[];
};

export type ExistingSupplierProductRef = {
  supplierId: string;
  sku: string | null;
  normalizedDescription: string;
};

const CREATABLE_STATUSES = new Set<InvoiceReviewStatus>(["needs_review", "unmatched"]);

export function proposeMaterialFromInvoiceLine(input: {
  description: string;
  sku: string | null;
  unit: string | null;
  unitPrice: number | null;
}): InvoiceMaterialDraft {
  const description = input.description.replace(/\s+/g, " ").trim();
  const size = rollSize(description);
  const purchaseUnit = normalizePurchaseUnit(input.unit);
  const familyName = britelineWhitebackName(description, size);
  const notes = [
    "Product family stays in the material name. There is no separate brand field.",
    "Blank specification fields were not stated on the invoice.",
  ];

  if (familyName) {
    notes.unshift(
      "The proposed name follows Briteline Greyback Removable 1370mm x 50m, using whiteback and permanent from this line."
    );
  }

  return {
    name: familyName ?? description,
    category: /vinyl/i.test(description) ? "Vinyl" : null,
    thicknessMm: thicknessOutsideSize(description),
    colour: /\b(?:wht|white)\b/i.test(description) ? "White" : null,
    finish: explicitFinish(description),
    purchaseUnit,
    purchaseWidthMm: size?.widthMm ?? null,
    purchaseHeightMm: null,
    purchaseLengthMm: purchaseUnit === "roll" ? size?.lengthMm ?? null : null,
    supplierDescription: description,
    supplierSku: input.sku,
    price: input.unitPrice,
    preferred: true,
    notes,
  };
}

export function invoiceMaterialConflict(input: {
  reviewStatus: InvoiceReviewStatus;
  openingPriceAlreadyCreated: boolean;
  name: string;
  category: string | null;
  thicknessMm: number | null;
  colour: string | null;
  finish: string | null;
  purchaseUnit: PurchaseUnit;
  purchaseWidthMm: number | null;
  purchaseHeightMm: number | null;
  purchaseLengthMm: number | null;
  supplierId: string;
  supplierSku: string | null;
  supplierDescription: string;
  existingIdentityKeys: readonly string[];
  existingProducts: readonly ExistingSupplierProductRef[];
}) {
  if (!CREATABLE_STATUSES.has(input.reviewStatus)) {
    return "Only a needs-review or unmatched line can create a material.";
  }

  if (input.openingPriceAlreadyCreated) {
    return "This invoice line has already created an opening price.";
  }

  const identityKey = buildMaterialIdentityKey({
    name: input.name,
    thicknessMm: input.thicknessMm,
    colour: input.colour,
    finish: input.finish,
    purchaseUnit: input.purchaseUnit,
    purchaseWidthMm: input.purchaseWidthMm,
    purchaseHeightMm: input.purchaseHeightMm,
    purchaseLengthMm: input.purchaseLengthMm,
  });

  if (input.existingIdentityKeys.includes(identityKey)) {
    return "A material with this name and specification already exists.";
  }

  const sku = input.supplierSku?.trim().toLowerCase() ?? "";

  if (
    sku &&
    input.existingProducts.some(
      (product) =>
        product.supplierId === input.supplierId &&
        product.sku?.trim().toLowerCase() === sku
    )
  ) {
    return "This supplier already has that SKU.";
  }

  const description = normalizeSupplierDescription(input.supplierDescription);

  if (
    input.existingProducts.some(
      (product) =>
        product.supplierId === input.supplierId &&
        product.normalizedDescription === description
    )
  ) {
    return "This supplier already has that product description.";
  }

  return null;
}

function britelineWhitebackName(
  description: string,
  size: { widthMm: number; lengthMetres: number } | null
) {
  const permanentWhite =
    /briteline/i.test(description) &&
    /permanent/i.test(description) &&
    /\bwht\b|\bwhite\b/i.test(description) &&
    !/removable|greyback/i.test(description);

  if (!permanentWhite || !size) {
    return null;
  }

  const metres = Number.isInteger(size.lengthMetres)
    ? String(size.lengthMetres)
    : String(size.lengthMetres);
  const width = Number.isInteger(size.widthMm) ? String(size.widthMm) : String(size.widthMm);

  return `Briteline Whiteback Permanent ${width}mm x ${metres}m`;
}

function rollSize(description: string) {
  const match = description.match(/(\d+(?:\.\d+)?)\s*mm\s*[x×]\s*(\d+(?:\.\d+)?)\s*m\b/i);

  if (!match) {
    return null;
  }

  const widthMm = Number(match[1]);
  const lengthMetres = Number(match[2]);

  if (!Number.isFinite(widthMm) || !Number.isFinite(lengthMetres) || widthMm <= 0 || lengthMetres <= 0) {
    return null;
  }

  return { widthMm, lengthMetres, lengthMm: Math.round(lengthMetres * 1000) };
}

function thicknessOutsideSize(description: string) {
  const withoutSize = description.replace(
    /(\d+(?:\.\d+)?)\s*mm\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm|m)\b/gi,
    " "
  );
  const match = withoutSize.match(/\b(\d+(?:\.\d+)?)\s*mm\b/i);

  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return value > 0 && value <= 100 ? value : null;
}

function explicitFinish(description: string) {
  const match = description.match(/\b(semi-matt|semi matt|matt|matte|gloss)\b/i);

  if (!match) {
    return null;
  }

  if (/semi/i.test(match[1])) {
    return "Semi-matt";
  }

  return match[1].toLowerCase() === "gloss" ? "Gloss" : "Matt";
}
