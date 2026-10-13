import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatMaterialSpecification,
  formatPurchaseFormat,
  coercePurchaseUnit,
  type MaterialRecord,
} from "@/lib/materials/present";
import type { PurchaseUnit } from "@/lib/materials/units";
import { selectCurrentApprovedPrice, type ApprovedPriceRecord } from "@/lib/materials/pricing";
import { approvedRatePerSquareMetre } from "@/lib/quotes/costing";

export type QuoteMaterialCatalogProduct = {
  id: string;
  supplierName: string;
  supplierSku: string | null;
  isPreferred: boolean;
  currentPriceId: string | null;
  currentPrice: number | null;
  currentPriceUnit: PurchaseUnit | null;
  currentRatePerSqm: number | null;
  effectiveDate: string | null;
};

export type QuoteMaterialCatalogItem = {
  id: string;
  name: string;
  specification: string;
  purchaseFormat: string;
  searchText: string;
  products: QuoteMaterialCatalogProduct[];
};

type CatalogResult =
  | { ok: true; materials: QuoteMaterialCatalogItem[] }
  | { ok: false; error: string };

function numeric(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function supplierName(value: { name?: string } | { name?: string }[] | null) {
  if (Array.isArray(value)) {
    return value[0]?.name ?? null;
  }

  return value?.name ?? null;
}

export async function loadQuoteMaterialCatalog(
  supabase: SupabaseClient
): Promise<CatalogResult> {
  const { data: materialRows, error: materialError } = await supabase
    .from("materials")
    .select(
      "id, name, category, thickness_mm, colour, finish, purchase_unit, purchase_width_mm, purchase_height_mm, purchase_length_mm, active"
    )
    .eq("active", true)
    .order("name", { ascending: true });

  if (materialError) {
    return { ok: false, error: "Approved materials could not be loaded." };
  }

  const materials = (materialRows ?? []).flatMap((row) => {
    const purchaseUnit = coercePurchaseUnit(String(row.purchase_unit ?? ""));

    if (!purchaseUnit) {
      return [];
    }

    const material: MaterialRecord = {
      id: String(row.id),
      name: String(row.name),
      category: (row.category as string | null) ?? null,
      thicknessMm: numeric(row.thickness_mm),
      colour: (row.colour as string | null) ?? null,
      finish: (row.finish as string | null) ?? null,
      purchaseUnit,
      purchaseWidthMm: numeric(row.purchase_width_mm),
      purchaseHeightMm: numeric(row.purchase_height_mm),
      purchaseLengthMm: numeric(row.purchase_length_mm),
      active: true,
    };

    return [material];
  });

  if (materials.length === 0) {
    return { ok: true, materials: [] };
  }

  const { data: productRows, error: productError } = await supabase
    .from("material_supplier_products")
    .select(
      "id, material_id, supplier_sku, is_preferred, active, suppliers(name)"
    )
    .in(
      "material_id",
      materials.map((material) => material.id)
    )
    .eq("active", true);

  if (productError) {
    return { ok: false, error: "Approved materials could not be loaded." };
  }

  const products = (productRows ?? []).flatMap((row) => {
    const name = supplierName(
      row.suppliers as { name?: string } | { name?: string }[] | null
    );

    if (!name) {
      return [];
    }

    return [
      {
        id: String(row.id),
        materialId: String(row.material_id),
        supplierName: name,
        supplierSku: (row.supplier_sku as string | null) ?? null,
        isPreferred: Boolean(row.is_preferred),
      },
    ];
  });

  const productIds = products.map((product) => product.id);
  const pricesByProduct = new Map<string, ApprovedPriceRecord[]>();

  if (productIds.length > 0) {
    const { data: priceRows, error: priceError } = await supabase
      .from("material_prices")
      .select(
        "id, material_supplier_product_id, price, price_unit, effective_date, approved_at, created_at"
      )
      .in("material_supplier_product_id", productIds);

    if (priceError) {
      return { ok: false, error: "Approved materials could not be loaded." };
    }

    for (const row of priceRows ?? []) {
      const priceUnit = coercePurchaseUnit(String(row.price_unit ?? ""));
      const price = numeric(row.price);

      if (!priceUnit || price == null || row.approved_at == null) {
        continue;
      }

      const productId = String(row.material_supplier_product_id);
      const record: ApprovedPriceRecord = {
        id: String(row.id),
        price,
        priceUnit,
        effectiveDate: String(row.effective_date),
        approvedAt: String(row.approved_at),
        createdAt: String(row.created_at),
      };
      pricesByProduct.set(productId, [...(pricesByProduct.get(productId) ?? []), record]);
    }
  }

  const catalog = materials.map((material) => {
    const materialProducts = products
      .filter((product) => product.materialId === material.id)
      .map((product) => {
        const current = selectCurrentApprovedPrice(pricesByProduct.get(product.id) ?? []);
        const currentRatePerSqm = current
          ? approvedRatePerSquareMetre({
              price: current.price,
              priceUnit: current.priceUnit,
              widthMm: material.purchaseWidthMm,
              heightMm: material.purchaseHeightMm,
              lengthMm: material.purchaseLengthMm,
            })
          : null;

        return {
          id: product.id,
          supplierName: product.supplierName,
          supplierSku: product.supplierSku,
          isPreferred: product.isPreferred,
          currentPriceId: current?.id ?? null,
          currentPrice: current?.price ?? null,
          currentPriceUnit: current?.priceUnit ?? null,
          currentRatePerSqm,
          effectiveDate: current?.effectiveDate ?? null,
        };
      })
      .sort((left, right) => {
        if (left.isPreferred !== right.isPreferred) {
          return left.isPreferred ? -1 : 1;
        }

        return left.supplierName.localeCompare(right.supplierName);
      });

    const specification = formatMaterialSpecification(material);
    const purchaseFormat = formatPurchaseFormat(material);

    return {
      id: material.id,
      name: material.name,
      specification,
      purchaseFormat,
      searchText: [
        material.name,
        material.category,
        specification,
        purchaseFormat,
        ...materialProducts.flatMap((product) => [product.supplierName, product.supplierSku]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
      products: materialProducts,
    };
  });

  return { ok: true, materials: catalog };
}
