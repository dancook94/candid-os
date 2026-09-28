import type { PurchaseUnit } from "@/lib/materials/units";

export type MaterialIdentityInput = {
  name: string;
  thicknessMm: number | null;
  colour: string | null;
  finish: string | null;
  purchaseUnit: PurchaseUnit;
  purchaseWidthMm: number | null;
  purchaseHeightMm: number | null;
  purchaseLengthMm: number | null;
};

export function normalizeMaterialLabel(value: string | null | undefined) {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

export function normalizeSupplierName(value: string) {
  return (normalizeMaterialLabel(value) ?? "").toLowerCase();
}

function quantizeMillimetres(value: number | null) {
  if (value == null) {
    return "";
  }

  return String(Math.round(value * 1000));
}

/**
 * Canonical identity. Supplier description, SKU, and price are not included.
 * Must stay aligned with public.material_identity_key in the materials migration.
 */
export function buildMaterialIdentityKey(input: MaterialIdentityInput) {
  return [
    (normalizeMaterialLabel(input.name) ?? "").toLowerCase(),
    quantizeMillimetres(input.thicknessMm),
    (normalizeMaterialLabel(input.colour) ?? "").toLowerCase(),
    (normalizeMaterialLabel(input.finish) ?? "").toLowerCase(),
    input.purchaseUnit,
    quantizeMillimetres(input.purchaseWidthMm),
    quantizeMillimetres(input.purchaseHeightMm),
    quantizeMillimetres(input.purchaseLengthMm),
  ].join("|");
}
