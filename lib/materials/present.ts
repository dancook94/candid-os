import { formatGbp } from "@/lib/format-currency";
import {
  calculateCostPerSquareMetre,
  selectCurrentApprovedPrice,
  selectPreferredSupplierProduct,
  type ApprovedPriceRecord,
} from "@/lib/materials/pricing";
import {
  isPurchaseUnit,
  PURCHASE_UNIT_LABELS,
  type PurchaseUnit,
} from "@/lib/materials/units";

export type SupplierRecord = {
  id: string;
  name: string;
  active: boolean;
  productCount: number;
};

export type MaterialRecord = {
  id: string;
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
};

export type SupplierProductView = {
  id: string;
  materialId: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string | null;
  supplierDescription: string;
  isPreferred: boolean;
  active: boolean;
  currentPrice: ApprovedPriceRecord | null;
  costPerSquareMetre: number | null;
};

export type MaterialListRow = {
  material: MaterialRecord;
  specification: string;
  purchaseFormat: string;
  preferredSupplierName: string | null;
  currentCostLabel: string;
  costPerSquareMetreLabel: string;
  lastUpdatedLabel: string;
  searchText: string;
};

export type PriceHistoryRow = {
  id: string;
  supplierName: string;
  supplierDescription: string;
  priceLabel: string;
  priceUnitLabel: string;
  costPerSquareMetreLabel: string;
  effectiveDateLabel: string;
  approvedAtLabel: string;
  sourceLabel: string;
  effectiveDate: string;
  approvedAt: string;
  createdAt: string;
};

function formatMillimetres(value: number) {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 1,
  }).format(value);
}

function formatOptionalNumber(value: number | null, suffix: string) {
  if (value == null) {
    return null;
  }

  return `${formatMillimetres(value)}${suffix}`;
}

export function formatMaterialSpecification(material: MaterialRecord) {
  const parts = [
    formatOptionalNumber(material.thicknessMm, "mm"),
    material.colour,
    material.finish,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function formatPurchaseFormat(material: MaterialRecord) {
  const unit = PURCHASE_UNIT_LABELS[material.purchaseUnit];

  if (
    material.purchaseUnit === "sheet" &&
    material.purchaseWidthMm != null &&
    material.purchaseHeightMm != null
  ) {
    return `${formatMillimetres(material.purchaseWidthMm)} × ${formatMillimetres(material.purchaseHeightMm)} mm sheet`;
  }

  if (
    material.purchaseUnit === "roll" &&
    material.purchaseWidthMm != null &&
    material.purchaseLengthMm != null
  ) {
    return `${formatMillimetres(material.purchaseWidthMm)} mm × ${formatMillimetres(material.purchaseLengthMm / 1000)} m roll`;
  }

  if (material.purchaseUnit === "linear_metre" && material.purchaseWidthMm != null) {
    return `${formatMillimetres(material.purchaseWidthMm)} mm wide linear metre`;
  }

  return unit;
}

export function formatMaterialDate(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatCostPerSquareMetre(value: number | null) {
  if (value == null) {
    return "—";
  }

  return `${formatGbp(value)}/m²`;
}

export function buildSupplierProductViews(input: {
  material: MaterialRecord;
  products: Array<{
    id: string;
    materialId: string;
    supplierId: string;
    supplierName: string;
    supplierSku: string | null;
    supplierDescription: string;
    isPreferred: boolean;
    active: boolean;
  }>;
  prices: Array<
    ApprovedPriceRecord & {
      productId: string;
    }
  >;
}): SupplierProductView[] {
  return input.products
    .filter((product) => product.materialId === input.material.id)
    .map((product) => {
      const currentPrice = selectCurrentApprovedPrice(
        input.prices.filter((price) => price.productId === product.id)
      );
      const costPerSquareMetre = currentPrice
        ? calculateCostPerSquareMetre({
            price: currentPrice.price,
            priceUnit: currentPrice.priceUnit,
            widthMm: input.material.purchaseWidthMm,
            heightMm: input.material.purchaseHeightMm,
            lengthMm: input.material.purchaseLengthMm,
          })
        : null;

      return {
        ...product,
        currentPrice,
        costPerSquareMetre,
      };
    })
    .sort((left, right) => {
      if (left.isPreferred !== right.isPreferred) {
        return left.isPreferred ? -1 : 1;
      }

      return left.supplierName.localeCompare(right.supplierName);
    });
}

export function buildMaterialListRow(input: {
  material: MaterialRecord;
  products: SupplierProductView[];
}): MaterialListRow {
  const preferred = selectPreferredSupplierProduct(input.products);
  const specification = formatMaterialSpecification(input.material);
  const purchaseFormat = formatPurchaseFormat(input.material);
  const currentCostLabel = !preferred
    ? "Select a supplier"
    : preferred.currentPrice
      ? formatGbp(preferred.currentPrice.price)
      : "No approved price";
  const costPerSquareMetreLabel = preferred?.costPerSquareMetre
    ? formatCostPerSquareMetre(preferred.costPerSquareMetre)
    : "—";
  const lastUpdatedLabel = preferred?.currentPrice
    ? formatMaterialDate(preferred.currentPrice.effectiveDate)
    : "—";

  return {
    material: input.material,
    specification,
    purchaseFormat,
    preferredSupplierName: preferred?.supplierName ?? null,
    currentCostLabel,
    costPerSquareMetreLabel,
    lastUpdatedLabel,
    searchText: [
      input.material.name,
      input.material.category,
      specification,
      purchaseFormat,
      preferred?.supplierName,
      ...input.products.map((product) => product.supplierDescription),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

export function buildPriceHistory(input: {
  material: MaterialRecord;
  products: SupplierProductView[];
  prices: Array<
    ApprovedPriceRecord & {
      productId: string;
      sourceType: string | null;
      sourceReference: string | null;
    }
  >;
}): PriceHistoryRow[] {
  const productsById = new Map(
    input.products.map((product) => [product.id, product])
  );

  return input.prices
    .flatMap((price) => {
      const product = productsById.get(price.productId);

      if (!product) {
        return [];
      }

      const costPerSquareMetre = calculateCostPerSquareMetre({
        price: price.price,
        priceUnit: price.priceUnit,
        widthMm: input.material.purchaseWidthMm,
        heightMm: input.material.purchaseHeightMm,
        lengthMm: input.material.purchaseLengthMm,
      });

      return [
        {
          id: price.id,
          supplierName: product.supplierName,
          supplierDescription: product.supplierDescription,
          priceLabel: formatGbp(price.price),
          priceUnitLabel: PURCHASE_UNIT_LABELS[price.priceUnit],
          costPerSquareMetreLabel: formatCostPerSquareMetre(costPerSquareMetre),
          effectiveDateLabel: formatMaterialDate(price.effectiveDate),
          approvedAtLabel: formatMaterialDate(price.approvedAt),
          sourceLabel: price.sourceReference || price.sourceType || "Manual",
          effectiveDate: price.effectiveDate,
          approvedAt: price.approvedAt,
          createdAt: price.createdAt,
        },
      ];
    })
    .sort((left, right) => {
      const byDate = right.effectiveDate.localeCompare(left.effectiveDate);
      if (byDate !== 0) {
        return byDate;
      }

      const byApproval = right.approvedAt.localeCompare(left.approvedAt);
      if (byApproval !== 0) {
        return byApproval;
      }

      return right.createdAt.localeCompare(left.createdAt);
    });
}

export function coercePurchaseUnit(value: string): PurchaseUnit | null {
  return isPurchaseUnit(value) ? value : null;
}
