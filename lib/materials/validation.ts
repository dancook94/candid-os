import {
  buildMaterialIdentityKey,
  normalizeMaterialLabel,
  normalizeSupplierName,
} from "@/lib/materials/identity";
import { isPurchaseUnit, type PurchaseUnit } from "@/lib/materials/units";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FieldError = { ok: false; error: string };

export function parseUuid(value: unknown, label: string): string | FieldError {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return { ok: false, error: `${label} is not valid.` };
  }

  return value;
}

function parseRequiredLabel(
  value: unknown,
  label: string,
  maxLength: number
): string | FieldError {
  if (typeof value !== "string") {
    return { ok: false, error: `${label} is required.` };
  }

  const normalized = normalizeMaterialLabel(value);

  if (!normalized) {
    return { ok: false, error: `${label} is required.` };
  }

  if (normalized.length > maxLength) {
    return {
      ok: false,
      error: `${label} must be ${maxLength} characters or fewer.`,
    };
  }

  return normalized;
}

function parseOptionalLabel(
  value: unknown,
  label: string,
  maxLength: number
): string | null | FieldError {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return { ok: false, error: `${label} is not valid.` };
  }

  const normalized = normalizeMaterialLabel(value);

  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    return {
      ok: false,
      error: `${label} must be ${maxLength} characters or fewer.`,
    };
  }

  return normalized;
}

function parseOptionalDimension(
  value: unknown,
  label: string
): number | null | FieldError {
  if (value == null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `${label} must be a number.` };
  }

  if (parsed <= 0) {
    return { ok: false, error: `${label} must be greater than zero.` };
  }

  return parsed;
}

function isFieldError(value: unknown): value is FieldError {
  return (
    typeof value === "object" &&
    value != null &&
    "ok" in value &&
    (value as FieldError).ok === false
  );
}

export type MaterialWriteInput = {
  name: string;
  category: string | null;
  thicknessMm: number | null;
  colour: string | null;
  finish: string | null;
  purchaseUnit: PurchaseUnit;
  purchaseWidthMm: number | null;
  purchaseHeightMm: number | null;
  purchaseLengthMm: number | null;
  active: boolean;
  identityKey: string;
};

export function parseMaterialWrite(
  body: Record<string, unknown>,
  options: { active?: boolean } = {}
): MaterialWriteInput | FieldError {
  const name = parseRequiredLabel(body.name, "Material name", 160);
  if (isFieldError(name)) {
    return name;
  }

  const category = parseOptionalLabel(body.category, "Category", 80);
  if (isFieldError(category)) {
    return category;
  }

  const colour = parseOptionalLabel(body.colour, "Colour", 80);
  if (isFieldError(colour)) {
    return colour;
  }

  const finish = parseOptionalLabel(body.finish, "Finish", 80);
  if (isFieldError(finish)) {
    return finish;
  }

  const thicknessMm = parseOptionalDimension(body.thicknessMm, "Thickness");
  if (isFieldError(thicknessMm)) {
    return thicknessMm;
  }

  const purchaseWidthMm = parseOptionalDimension(body.purchaseWidthMm, "Width");
  if (isFieldError(purchaseWidthMm)) {
    return purchaseWidthMm;
  }

  const purchaseHeightMm = parseOptionalDimension(
    body.purchaseHeightMm,
    "Height"
  );
  if (isFieldError(purchaseHeightMm)) {
    return purchaseHeightMm;
  }

  const purchaseLengthMm = parseOptionalDimension(
    body.purchaseLengthMm,
    "Length"
  );
  if (isFieldError(purchaseLengthMm)) {
    return purchaseLengthMm;
  }

  if (typeof body.purchaseUnit !== "string" || !isPurchaseUnit(body.purchaseUnit)) {
    return { ok: false, error: "Choose a purchase format." };
  }

  const active =
    options.active ?? (typeof body.active === "boolean" ? body.active : true);

  return {
    name,
    category,
    thicknessMm,
    colour,
    finish,
    purchaseUnit: body.purchaseUnit,
    purchaseWidthMm,
    purchaseHeightMm,
    purchaseLengthMm,
    active,
    identityKey: buildMaterialIdentityKey({
      name,
      thicknessMm,
      colour,
      finish,
      purchaseUnit: body.purchaseUnit,
      purchaseWidthMm,
      purchaseHeightMm,
      purchaseLengthMm,
    }),
  };
}

export type SupplierWriteInput = {
  name: string;
  normalizedName: string;
  active: boolean;
};

export function parseSupplierWrite(
  body: Record<string, unknown>,
  options: { active?: boolean } = {}
): SupplierWriteInput | FieldError {
  const name = parseRequiredLabel(body.name, "Supplier name", 160);
  if (isFieldError(name)) {
    return name;
  }

  return {
    name,
    normalizedName: normalizeSupplierName(name),
    active:
      options.active ?? (typeof body.active === "boolean" ? body.active : true),
  };
}

export type SupplierProductWriteInput = {
  supplierId: string;
  supplierSku: string | null;
  supplierDescription: string;
  isPreferred: boolean;
  active: boolean;
};

export function parseSupplierProductWrite(
  body: Record<string, unknown>,
  options: { active?: boolean; isPreferred?: boolean } = {}
): SupplierProductWriteInput | FieldError {
  const supplierId = parseUuid(body.supplierId, "Supplier");
  if (isFieldError(supplierId)) {
    return supplierId;
  }

  const supplierDescription = parseRequiredLabel(
    body.supplierDescription,
    "Supplier description",
    500
  );
  if (isFieldError(supplierDescription)) {
    return supplierDescription;
  }

  const supplierSku = parseOptionalLabel(body.supplierSku, "Supplier SKU", 80);
  if (isFieldError(supplierSku)) {
    return supplierSku;
  }

  const active =
    options.active ?? (typeof body.active === "boolean" ? body.active : true);
  const isPreferred =
    options.isPreferred ??
    (typeof body.isPreferred === "boolean" ? body.isPreferred : false);

  if (isPreferred && !active) {
    return {
      ok: false,
      error: "An inactive supplier product cannot be preferred.",
    };
  }

  return {
    supplierId,
    supplierSku,
    supplierDescription,
    isPreferred,
    active,
  };
}

export type ApprovedPriceWriteInput = {
  price: number;
  priceUnit: PurchaseUnit;
  effectiveDate: string;
  sourceReference: string | null;
};

export function parseApprovedPriceWrite(
  body: Record<string, unknown>
): ApprovedPriceWriteInput | FieldError {
  const price = typeof body.price === "number" ? body.price : Number(body.price);

  if (!Number.isFinite(price)) {
    return { ok: false, error: "Price must be a number." };
  }

  if (price <= 0) {
    return { ok: false, error: "Price must be greater than zero." };
  }

  if (typeof body.priceUnit !== "string" || !isPurchaseUnit(body.priceUnit)) {
    return { ok: false, error: "Choose a price unit." };
  }

  if (typeof body.effectiveDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate)) {
    return { ok: false, error: "Effective date is required." };
  }

  const [year, month, day] = body.effectiveDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    year < 2000 ||
    year > 2100
  ) {
    return { ok: false, error: "Effective date is not valid." };
  }

  const sourceReference = parseOptionalLabel(
    body.sourceReference,
    "Source reference",
    200
  );
  if (isFieldError(sourceReference)) {
    return sourceReference;
  }

  return {
    price,
    priceUnit: body.priceUnit,
    effectiveDate: body.effectiveDate,
    sourceReference,
  };
}

export function isMaterialsFieldError<T>(
  value: T | FieldError
): value is FieldError {
  return isFieldError(value);
}
