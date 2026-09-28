import type { PurchaseUnit } from "@/lib/materials/units";

export type ApprovedPriceRecord = {
  id: string;
  price: number;
  priceUnit: PurchaseUnit;
  effectiveDate: string;
  approvedAt: string;
  createdAt: string;
};

export type SupplierProductRecord = {
  id: string;
  active: boolean;
  isPreferred: boolean;
};

export type NormalisedCostInput = {
  price: number;
  priceUnit: PurchaseUnit;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
};

function compareIsoDesc(left: string, right: string) {
  return right.localeCompare(left);
}

export function selectCurrentApprovedPrice(
  prices: ApprovedPriceRecord[]
): ApprovedPriceRecord | null {
  if (prices.length === 0) {
    return null;
  }

  return [...prices].sort((left, right) => {
    const byDate = compareIsoDesc(left.effectiveDate, right.effectiveDate);
    if (byDate !== 0) {
      return byDate;
    }

    const byApproval = compareIsoDesc(left.approvedAt, right.approvedAt);
    if (byApproval !== 0) {
      return byApproval;
    }

    return compareIsoDesc(left.createdAt, right.createdAt);
  })[0];
}

export function selectPreferredSupplierProduct<T extends SupplierProductRecord>(
  products: T[]
): T | null {
  const preferred = products.filter(
    (product) => product.active && product.isPreferred
  );

  if (preferred.length !== 1) {
    return null;
  }

  return preferred[0];
}

export function applyPreferredSelection<T extends SupplierProductRecord>(
  products: T[],
  selectedId: string
): T[] {
  const selected = products.find((product) => product.id === selectedId);

  if (!selected?.active) {
    return products;
  }

  return products.map((product) => ({
    ...product,
    isPreferred: product.id === selectedId,
  }));
}

export function countActivePreferredProducts(
  products: SupplierProductRecord[]
) {
  return products.filter((product) => product.active && product.isPreferred)
    .length;
}

function squareMetresFromMillimetres(widthMm: number, lengthMm: number) {
  return (widthMm / 1000) * (lengthMm / 1000);
}

/**
 * Returns £/m² only when the price unit and dimensions make one answer.
 * Missing dimensions return null rather than an assumed size.
 */
export function calculateCostPerSquareMetre(
  input: NormalisedCostInput
): number | null {
  if (!Number.isFinite(input.price) || input.price <= 0) {
    return null;
  }

  if (input.priceUnit === "square_metre") {
    return input.price;
  }

  if (
    input.priceUnit === "sheet" &&
    input.widthMm != null &&
    input.heightMm != null &&
    input.widthMm > 0 &&
    input.heightMm > 0
  ) {
    return input.price / squareMetresFromMillimetres(input.widthMm, input.heightMm);
  }

  if (
    input.priceUnit === "roll" &&
    input.widthMm != null &&
    input.lengthMm != null &&
    input.widthMm > 0 &&
    input.lengthMm > 0
  ) {
    return input.price / squareMetresFromMillimetres(input.widthMm, input.lengthMm);
  }

  if (
    input.priceUnit === "linear_metre" &&
    input.widthMm != null &&
    input.widthMm > 0
  ) {
    return input.price / (input.widthMm / 1000);
  }

  return null;
}
