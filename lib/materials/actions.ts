import { revalidatePath } from "next/cache";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import {
  isMaterialsFieldError,
  parseApprovedPriceWrite,
  parseMaterialWrite,
  parseSupplierProductWrite,
  parseSupplierWrite,
  parseUuid,
} from "@/lib/materials/validation";
import { mapMaterialsWriteError } from "@/lib/materials/write-error";

type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; status: number; error: string };

function refreshMaterials(materialId?: string) {
  revalidatePath("/admin/materials");
  revalidatePath("/admin/materials/suppliers");

  if (materialId) {
    revalidatePath(`/admin/materials/${materialId}`);
  }
}

async function requireMaterialsAdmin() {
  const supabase = await createClient();
  const auth = await verifyApprovedAdmin(supabase);

  if (!auth.ok) {
    return {
      supabase,
      auth,
    } as const;
  }

  return { supabase, auth } as const;
}

function asRecord(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  return body as Record<string, unknown>;
}

export async function createMaterialRecord(
  body: unknown
): Promise<ActionResult> {
  const record = asRecord(body);

  if (!record) {
    return { ok: false, status: 400, error: "Invalid request body." };
  }

  const parsed = parseMaterialWrite(record, { active: true });

  if (isMaterialsFieldError(parsed)) {
    return { ok: false, status: 400, error: parsed.error };
  }

  const { supabase, auth } = await requireMaterialsAdmin();

  if (!auth.ok) {
    return { ok: false, status: auth.status, error: auth.message };
  }

  const { data, error } = await supabase
    .from("materials")
    .insert({
      name: parsed.name,
      category: parsed.category,
      thickness_mm: parsed.thicknessMm,
      colour: parsed.colour,
      finish: parsed.finish,
      purchase_unit: parsed.purchaseUnit,
      purchase_width_mm: parsed.purchaseWidthMm,
      purchase_height_mm: parsed.purchaseHeightMm,
      purchase_length_mm: parsed.purchaseLengthMm,
      identity_key: parsed.identityKey,
      active: true,
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      status: 400,
      error: mapMaterialsWriteError(error ?? {}),
    };
  }

  refreshMaterials(data.id);
  return { ok: true, id: data.id };
}

export async function updateMaterialRecord(
  materialId: string,
  body: unknown
): Promise<ActionResult> {
  const id = parseUuid(materialId, "Material");

  if (isMaterialsFieldError(id)) {
    return { ok: false, status: 400, error: id.error };
  }

  const record = asRecord(body);

  if (!record) {
    return { ok: false, status: 400, error: "Invalid request body." };
  }

  const parsed = parseMaterialWrite(record);

  if (isMaterialsFieldError(parsed)) {
    return { ok: false, status: 400, error: parsed.error };
  }

  const { supabase, auth } = await requireMaterialsAdmin();

  if (!auth.ok) {
    return { ok: false, status: auth.status, error: auth.message };
  }

  const { data, error } = await supabase
    .from("materials")
    .update({
      name: parsed.name,
      category: parsed.category,
      thickness_mm: parsed.thicknessMm,
      colour: parsed.colour,
      finish: parsed.finish,
      purchase_unit: parsed.purchaseUnit,
      purchase_width_mm: parsed.purchaseWidthMm,
      purchase_height_mm: parsed.purchaseHeightMm,
      purchase_length_mm: parsed.purchaseLengthMm,
      identity_key: parsed.identityKey,
      active: parsed.active,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, status: 400, error: mapMaterialsWriteError(error) };
  }

  if (!data) {
    return { ok: false, status: 404, error: "Material not found." };
  }

  refreshMaterials(id);
  return { ok: true, id };
}

export async function createSupplierRecord(
  body: unknown
): Promise<ActionResult> {
  const record = asRecord(body);

  if (!record) {
    return { ok: false, status: 400, error: "Invalid request body." };
  }

  const parsed = parseSupplierWrite(record, { active: true });

  if (isMaterialsFieldError(parsed)) {
    return { ok: false, status: 400, error: parsed.error };
  }

  const { supabase, auth } = await requireMaterialsAdmin();

  if (!auth.ok) {
    return { ok: false, status: auth.status, error: auth.message };
  }

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name: parsed.name,
      normalized_name: parsed.normalizedName,
      active: true,
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      status: 400,
      error: mapMaterialsWriteError(error ?? {}),
    };
  }

  refreshMaterials();
  return { ok: true, id: data.id };
}

export async function updateSupplierRecord(
  supplierId: string,
  body: unknown
): Promise<ActionResult> {
  const id = parseUuid(supplierId, "Supplier");

  if (isMaterialsFieldError(id)) {
    return { ok: false, status: 400, error: id.error };
  }

  const record = asRecord(body);

  if (!record) {
    return { ok: false, status: 400, error: "Invalid request body." };
  }

  const parsed = parseSupplierWrite(record);

  if (isMaterialsFieldError(parsed)) {
    return { ok: false, status: 400, error: parsed.error };
  }

  const { supabase, auth } = await requireMaterialsAdmin();

  if (!auth.ok) {
    return { ok: false, status: auth.status, error: auth.message };
  }

  const { data, error } = await supabase
    .from("suppliers")
    .update({
      name: parsed.name,
      normalized_name: parsed.normalizedName,
      active: parsed.active,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, status: 400, error: mapMaterialsWriteError(error) };
  }

  if (!data) {
    return { ok: false, status: 404, error: "Supplier not found." };
  }

  refreshMaterials();
  return { ok: true, id };
}

export async function createSupplierProductRecord(
  materialId: string,
  body: unknown
): Promise<ActionResult> {
  const id = parseUuid(materialId, "Material");

  if (isMaterialsFieldError(id)) {
    return { ok: false, status: 400, error: id.error };
  }

  const record = asRecord(body);

  if (!record) {
    return { ok: false, status: 400, error: "Invalid request body." };
  }

  const parsed = parseSupplierProductWrite(record, { active: true });

  if (isMaterialsFieldError(parsed)) {
    return { ok: false, status: 400, error: parsed.error };
  }

  const { supabase, auth } = await requireMaterialsAdmin();

  if (!auth.ok) {
    return { ok: false, status: auth.status, error: auth.message };
  }

  const { data, error } = await supabase
    .from("material_supplier_products")
    .insert({
      material_id: id,
      supplier_id: parsed.supplierId,
      supplier_sku: parsed.supplierSku,
      supplier_description: parsed.supplierDescription,
      normalized_description: parsed.supplierDescription.toLowerCase(),
      is_preferred: false,
      active: true,
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      status: 400,
      error: mapMaterialsWriteError(error ?? {}),
    };
  }

  if (parsed.isPreferred) {
    const { error: preferError } = await supabase.rpc(
      "set_material_supplier_product_preferred",
      { p_product_id: data.id }
    );

    if (preferError) {
      refreshMaterials(id);
      return {
        ok: false,
        status: 400,
        error: mapMaterialsWriteError(preferError),
      };
    }
  }

  refreshMaterials(id);
  return { ok: true, id: data.id };
}

export async function updateSupplierProductRecord(
  productId: string,
  body: unknown
): Promise<ActionResult> {
  const id = parseUuid(productId, "Supplier product");

  if (isMaterialsFieldError(id)) {
    return { ok: false, status: 400, error: id.error };
  }

  const record = asRecord(body);

  if (!record) {
    return { ok: false, status: 400, error: "Invalid request body." };
  }

  const parsed = parseSupplierProductWrite(record);

  if (isMaterialsFieldError(parsed)) {
    return { ok: false, status: 400, error: parsed.error };
  }

  const { supabase, auth } = await requireMaterialsAdmin();

  if (!auth.ok) {
    return { ok: false, status: auth.status, error: auth.message };
  }

  const { data: existing, error: existingError } = await supabase
    .from("material_supplier_products")
    .select("id, material_id")
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return {
      ok: false,
      status: 400,
      error: mapMaterialsWriteError(existingError),
    };
  }

  if (!existing) {
    return { ok: false, status: 404, error: "Supplier product not found." };
  }

  const productUpdate: {
    supplier_id: string;
    supplier_sku: string | null;
    supplier_description: string;
    normalized_description: string;
    active: boolean;
    is_preferred?: boolean;
  } = {
    supplier_id: parsed.supplierId,
    supplier_sku: parsed.supplierSku,
    supplier_description: parsed.supplierDescription,
    normalized_description: parsed.supplierDescription.toLowerCase(),
    active: parsed.active,
  };

  if (!(parsed.active && parsed.isPreferred)) {
    productUpdate.is_preferred = false;
  }

  const { error } = await supabase
    .from("material_supplier_products")
    .update(productUpdate)
    .eq("id", id);

  if (error) {
    return { ok: false, status: 400, error: mapMaterialsWriteError(error) };
  }

  if (parsed.active && parsed.isPreferred) {
    const { error: preferError } = await supabase.rpc(
      "set_material_supplier_product_preferred",
      { p_product_id: id }
    );

    if (preferError) {
      refreshMaterials(existing.material_id);
      return {
        ok: false,
        status: 400,
        error: mapMaterialsWriteError(preferError),
      };
    }
  }

  refreshMaterials(existing.material_id);
  return { ok: true, id };
}

export async function createApprovedPriceRecord(
  productId: string,
  body: unknown
): Promise<ActionResult> {
  const id = parseUuid(productId, "Supplier product");

  if (isMaterialsFieldError(id)) {
    return { ok: false, status: 400, error: id.error };
  }

  const record = asRecord(body);

  if (!record) {
    return { ok: false, status: 400, error: "Invalid request body." };
  }

  const parsed = parseApprovedPriceWrite(record);

  if (isMaterialsFieldError(parsed)) {
    return { ok: false, status: 400, error: parsed.error };
  }

  const { supabase, auth } = await requireMaterialsAdmin();

  if (!auth.ok) {
    return { ok: false, status: auth.status, error: auth.message };
  }

  const { data: product, error: productError } = await supabase
    .from("material_supplier_products")
    .select("id, material_id, active")
    .eq("id", id)
    .maybeSingle();

  if (productError) {
    return {
      ok: false,
      status: 400,
      error: mapMaterialsWriteError(productError),
    };
  }

  if (!product) {
    return { ok: false, status: 404, error: "Supplier product not found." };
  }

  if (!product.active) {
    return {
      ok: false,
      status: 400,
      error: "Add prices to an active supplier product.",
    };
  }

  const { data, error } = await supabase
    .from("material_prices")
    .insert({
      material_supplier_product_id: id,
      price: parsed.price,
      currency: "GBP",
      price_unit: parsed.priceUnit,
      effective_date: parsed.effectiveDate,
      approved_by: auth.userId,
      source_type: "manual",
      source_reference: parsed.sourceReference,
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      status: 400,
      error: mapMaterialsWriteError(error ?? {}),
    };
  }

  refreshMaterials(product.material_id);
  return { ok: true, id: data.id };
}
