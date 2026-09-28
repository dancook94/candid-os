import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildMaterialListRow,
  buildPriceHistory,
  buildSupplierProductViews,
  coercePurchaseUnit,
  type MaterialListRow,
  type MaterialRecord,
  type PriceHistoryRow,
  type SupplierProductView,
  type SupplierRecord,
} from "@/lib/materials/present";
import type { ApprovedPriceRecord } from "@/lib/materials/pricing";
import { isMaterialsSchemaMissing } from "@/lib/materials/write-error";

type QueryError = { code?: string; message?: string } | null;

export type MaterialsQueryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; schemaMissing: boolean };

function numeric(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fail(error: QueryError): {
  ok: false;
  error: string;
  schemaMissing: boolean;
} {
  return {
    ok: false,
    error: isMaterialsSchemaMissing(error)
      ? "Material tables are not in this database yet. Apply the materials migration in Supabase, then reload this page."
      : "Materials could not be loaded.",
    schemaMissing: isMaterialsSchemaMissing(error),
  };
}

function toMaterial(row: {
  id: string;
  name: string;
  category: string | null;
  thickness_mm: unknown;
  colour: string | null;
  finish: string | null;
  purchase_unit: string;
  purchase_width_mm: unknown;
  purchase_height_mm: unknown;
  purchase_length_mm: unknown;
  active: boolean;
}): MaterialRecord | null {
  const purchaseUnit = coercePurchaseUnit(row.purchase_unit);

  if (!purchaseUnit) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    thicknessMm: numeric(row.thickness_mm),
    colour: row.colour,
    finish: row.finish,
    purchaseUnit,
    purchaseWidthMm: numeric(row.purchase_width_mm),
    purchaseHeightMm: numeric(row.purchase_height_mm),
    purchaseLengthMm: numeric(row.purchase_length_mm),
    active: row.active,
  };
}

const materialSelect =
  "id, name, category, thickness_mm, colour, finish, purchase_unit, purchase_width_mm, purchase_height_mm, purchase_length_mm, active";

async function loadProductGraph(
  supabase: SupabaseClient,
  materialIds: string[]
) {
  if (materialIds.length === 0) {
    return {
      ok: true as const,
      products: [] as SupplierProductView[],
      prices: [] as Array<
        ApprovedPriceRecord & {
          productId: string;
          sourceType: string | null;
          sourceReference: string | null;
        }
      >,
      rawProducts: [] as Array<{
        id: string;
        materialId: string;
        supplierId: string;
        supplierName: string;
        supplierSku: string | null;
        supplierDescription: string;
        isPreferred: boolean;
        active: boolean;
      }>,
    };
  }

  const { data: productRows, error: productError } = await supabase
    .from("material_supplier_products")
    .select(
      "id, material_id, supplier_id, supplier_sku, supplier_description, is_preferred, active, suppliers(name)"
    )
    .in("material_id", materialIds);

  if (productError) {
    return fail(productError);
  }

  const rawProducts = (productRows ?? []).flatMap((row) => {
    const supplierJoin = row.suppliers as { name?: string } | { name?: string }[] | null;
    const supplierName = Array.isArray(supplierJoin)
      ? supplierJoin[0]?.name
      : supplierJoin?.name;

    if (!supplierName) {
      return [];
    }

    return [
      {
        id: row.id as string,
        materialId: row.material_id as string,
        supplierId: row.supplier_id as string,
        supplierName,
        supplierSku: (row.supplier_sku as string | null) ?? null,
        supplierDescription: row.supplier_description as string,
        isPreferred: Boolean(row.is_preferred),
        active: Boolean(row.active),
      },
    ];
  });

  const productIds = rawProducts.map((product) => product.id);
  let priceData: Array<Record<string, unknown>> = [];

  if (productIds.length > 0) {
    const prices = await supabase
      .from("material_prices")
      .select(
        "id, material_supplier_product_id, price, price_unit, effective_date, approved_at, created_at, source_type, source_reference"
      )
      .in("material_supplier_product_id", productIds);

    if (prices.error) {
      return fail(prices.error);
    }

    priceData = prices.data ?? [];
  }

  const priceRows = priceData.flatMap((row) => {
    const priceUnit = coercePurchaseUnit(String(row.price_unit ?? ""));
    const amount = numeric(row.price);

    if (!priceUnit || amount == null) {
      return [];
    }

    return [
      {
        id: String(row.id),
        productId: String(row.material_supplier_product_id),
        price: amount,
        priceUnit,
        effectiveDate: String(row.effective_date).slice(0, 10),
        approvedAt: String(row.approved_at),
        createdAt: String(row.created_at),
        sourceType: (row.source_type as string | null) ?? null,
        sourceReference: (row.source_reference as string | null) ?? null,
      },
    ];
  });

  return {
    ok: true as const,
    products: [] as SupplierProductView[],
    prices: priceRows,
    rawProducts,
  };
}

export async function loadMaterialsCatalog(
  supabase: SupabaseClient
): Promise<MaterialsQueryResult<MaterialListRow[]>> {
  const { data, error } = await supabase
    .from("materials")
    .select(materialSelect)
    .order("name", { ascending: true });

  if (error) {
    return fail(error);
  }

  const materials = (data ?? []).flatMap((row) => {
    const material = toMaterial(row);
    return material ? [material] : [];
  });
  const graph = await loadProductGraph(
    supabase,
    materials.map((material) => material.id)
  );

  if (!graph.ok) {
    return graph;
  }

  const rows = materials.map((material) => {
    const products = buildSupplierProductViews({
      material,
      products: graph.rawProducts,
      prices: graph.prices,
    });

    return buildMaterialListRow({ material, products });
  });

  return { ok: true, data: rows };
}

export type MaterialDetail = {
  material: MaterialRecord;
  products: SupplierProductView[];
  history: PriceHistoryRow[];
  specification: string;
  purchaseFormat: string;
};

export async function loadMaterialDetail(
  supabase: SupabaseClient,
  materialId: string
): Promise<MaterialsQueryResult<MaterialDetail | null>> {
  const { data, error } = await supabase
    .from("materials")
    .select(materialSelect)
    .eq("id", materialId)
    .maybeSingle();

  if (error) {
    return fail(error);
  }

  if (!data) {
    return { ok: true, data: null };
  }

  const material = toMaterial(data);

  if (!material) {
    return { ok: true, data: null };
  }

  const graph = await loadProductGraph(supabase, [material.id]);

  if (!graph.ok) {
    return graph;
  }

  const products = buildSupplierProductViews({
    material,
    products: graph.rawProducts,
    prices: graph.prices,
  });

  const row = buildMaterialListRow({ material, products });

  return {
    ok: true,
    data: {
      material,
      products,
      history: buildPriceHistory({
        material,
        products,
        prices: graph.prices,
      }),
      specification: row.specification,
      purchaseFormat: row.purchaseFormat,
    },
  };
}

export async function loadSuppliers(
  supabase: SupabaseClient
): Promise<MaterialsQueryResult<SupplierRecord[]>> {
  const [{ data, error }, products] = await Promise.all([
    supabase.from("suppliers").select("id, name, active").order("name"),
    supabase.from("material_supplier_products").select("supplier_id"),
  ]);

  if (error) {
    return fail(error);
  }

  if (products.error && !isMaterialsSchemaMissing(products.error)) {
    return fail(products.error);
  }

  const counts = new Map<string, number>();

  for (const product of products.data ?? []) {
    const supplierId = product.supplier_id as string;
    counts.set(supplierId, (counts.get(supplierId) ?? 0) + 1);
  }

  return {
    ok: true,
    data: (data ?? []).map((supplier) => ({
      id: supplier.id as string,
      name: supplier.name as string,
      active: Boolean(supplier.active),
      productCount: counts.get(supplier.id as string) ?? 0,
    })),
  };
}
