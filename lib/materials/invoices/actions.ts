import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { normalizeSupplierDescription } from "@/lib/materials/identity";
import { invoiceMaterialConflict } from "@/lib/materials/invoices/new-material";
import { parseMaterialWrite, isMaterialsFieldError } from "@/lib/materials/validation";

import { findDuplicateInvoice } from "@/lib/materials/invoices/duplicate";
import { rebuildStoredInvoice } from "@/lib/materials/invoices/reprocess";
import { buildInvoiceDraft } from "@/lib/materials/invoices/draft";
import { extractInvoiceDocument } from "@/lib/materials/invoices/extract";
import { classifyInvoiceLine, deriveProcessingStatus } from "@/lib/materials/invoices/match";
import {
  SUPPLIER_INVOICE_FILES_BUCKET,
  type InvoiceReviewStatus,
} from "@/lib/materials/invoices/model";
import { isBlockedSupplierName } from "@/lib/materials/invoices/supplier";
import { loadInvoiceMatchCatalog } from "@/lib/materials/invoices/queries";

const MAX_BYTES = 15 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

type Failure = { ok: false; status: number; error: string };
type Duplicate = { ok: true; duplicate: true; invoiceId: string; message: string };

async function requireAdmin() {
  const supabase = await createClient();
  const auth = await verifyApprovedAdmin(supabase);

  if (!auth.ok) {
    return { ok: false as const, status: auth.status, error: auth.message };
  }

  return { ok: true as const, supabase, userId: auth.userId };
}

function refreshInvoicePages(invoiceId?: string) {
  revalidatePath("/admin/materials/invoices");

  if (invoiceId) {
    revalidatePath(`/admin/materials/invoices/${invoiceId}`);
  }
}

export async function uploadSupplierInvoice(file: File): Promise<
  | { ok: true; invoiceId: string; duplicate?: false }
  | Duplicate
  | Failure
> {
  const access = await requireAdmin();

  if (!access.ok) {
    return access;
  }

  const mimeType = resolveMimeType(file);

  if (!mimeType) {
    return { ok: false, status: 400, error: "Upload a PDF, JPG, or PNG invoice." };
  }

  if (file.size <= 0 || file.size > MAX_BYTES) {
    return { ok: false, status: 400, error: "Invoice files must be between 1 byte and 15 MB." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const catalog = await loadInvoiceMatchCatalog(access.supabase);

  if (!catalog.ok) {
    return { ok: false, status: 500, error: catalog.error };
  }

  const checksumDuplicate = findDuplicateInvoice({
    checksumSha256: checksum,
    supplierId: null,
    invoiceNumber: null,
    invoiceDate: null,
    existing: catalog.existingInvoices,
  });

  if (checksumDuplicate) {
    return {
      ok: true,
      duplicate: true,
      invoiceId: checksumDuplicate.invoiceId,
      message: checksumDuplicate.reason,
    };
  }

  const extracted = await extractInvoiceDocument({ bytes, mimeType });
  const draft = buildInvoiceDraft({
    text: extracted.text,
    extractionStatus: extracted.extractionStatus,
    extractionWarnings: extracted.warnings,
    suppliers: catalog.suppliers,
    aliases: catalog.aliases,
    products: catalog.products,
    mappings: catalog.mappings,
    ignoreRules: catalog.ignoreRules,
  });
  const identityDuplicate = findDuplicateInvoice({
    checksumSha256: checksum,
    supplierId: draft.supplierId,
    invoiceNumber: draft.invoiceNumber,
    invoiceDate: draft.invoiceDate,
    existing: catalog.existingInvoices,
  });

  if (identityDuplicate) {
    return {
      ok: true,
      duplicate: true,
      invoiceId: identityDuplicate.invoiceId,
      message: identityDuplicate.reason,
    };
  }

  const { data: invoice, error: invoiceError } = await access.supabase
    .from("supplier_invoices")
    .insert({
      supplier_id: draft.supplierId,
      raw_supplier_name: draft.rawSupplierName,
      invoice_number: draft.invoiceNumber,
      invoice_date: draft.invoiceDate,
      subtotal: draft.subtotal,
      vat: draft.vat,
      total: draft.total,
      currency: "GBP",
      extraction_status: draft.extractionStatus,
      processing_status: draft.processingStatus,
      source_type: "manual_upload",
      source_identifier: checksum,
      extraction_warnings: draft.warnings,
      created_by: access.userId,
    })
    .select("id")
    .single();

  if (invoiceError || !invoice) {
    return { ok: false, status: 400, error: "The invoice could not be stored." };
  }

  const storagePath = `${invoice.id}/${checksum.slice(0, 16)}-${safeFileName(file.name)}`;
  const { error: uploadError } = await access.supabase.storage
    .from(SUPPLIER_INVOICE_FILES_BUCKET)
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });

  if (uploadError) {
    await access.supabase.from("supplier_invoices").delete().eq("id", invoice.id);
    return { ok: false, status: 400, error: "The invoice file could not be stored." };
  }

  const { error: fileError } = await access.supabase.from("supplier_invoice_files").insert({
    invoice_id: invoice.id,
    storage_path: storagePath,
    original_filename: file.name,
    mime_type: mimeType,
    byte_size: file.size,
    checksum_sha256: checksum,
  });

  if (fileError) {
    await access.supabase.storage.from(SUPPLIER_INVOICE_FILES_BUCKET).remove([storagePath]);
    await access.supabase.from("supplier_invoices").delete().eq("id", invoice.id);
    return { ok: false, status: 400, error: "The invoice file record could not be stored." };
  }

  if (draft.lines.length > 0) {
    const { error: lineError } = await access.supabase.from("supplier_invoice_lines").insert(
      draft.lines.map((line) => ({
        invoice_id: invoice.id,
        line_number: line.lineNumber,
        raw_description: line.rawDescription,
        raw_supplier_sku: line.rawSupplierSku,
        raw_quantity: line.rawQuantity,
        raw_unit: line.rawUnit,
        raw_unit_price: line.rawUnitPrice,
        raw_line_total: line.rawLineTotal,
        raw_tax: line.rawTax,
        matched_supplier_product_id: line.matchedProductId,
        match_confidence: line.matchConfidence,
        match_method: line.matchMethod,
        review_status: line.reviewStatus,
        maths_warning: line.mathsWarning,
        internal_note: line.note,
      }))
    );

    if (lineError) {
      await access.supabase.storage.from(SUPPLIER_INVOICE_FILES_BUCKET).remove([storagePath]);
      await access.supabase.from("supplier_invoices").delete().eq("id", invoice.id);
      return { ok: false, status: 400, error: "The invoice lines could not be stored." };
    }
  }

  await recordEvent(access.supabase, {
    invoiceId: invoice.id,
    actorId: access.userId,
    action: "invoice_uploaded",
    metadata: { filename: file.name, checksum },
  });
  await recordEvent(access.supabase, {
    invoiceId: invoice.id,
    actorId: access.userId,
    action: draft.extractionStatus === "extracted" ? "extraction_completed" : "extraction_failed",
    metadata: {
      extractionStatus: draft.extractionStatus,
      lineCount: draft.lines.length,
      warnings: draft.warnings,
    },
  });

  refreshInvoicePages(invoice.id);
  return { ok: true, invoiceId: invoice.id };
}

export async function reprocessSupplierInvoice(invoiceId: string) {
  const access = await requireAdmin();

  if (!access.ok) {
    return access;
  }

  const result = await rebuildStoredInvoice(access.supabase, invoiceId, access.userId);

  if (result.ok) {
    refreshInvoicePages(invoiceId);
  }

  return result;
}

export async function createMaterialFromInvoiceLine(
  invoiceId: string,
  lineId: string,
  body: Record<string, unknown>
) {
  const access = await requireAdmin();

  if (!access.ok) {
    return access;
  }

  const parsed = parseMaterialWrite(body, { active: true });

  if (isMaterialsFieldError(parsed)) {
    return { ok: false as const, status: 400, error: parsed.error };
  }

  const supplierDescription = textValue(body.supplierDescription);
  const supplierSku = textValue(body.supplierSku);
  const price = numberValue(body.price);
  const effectiveDate = textValue(body.effectiveDate);
  const preferred = body.preferred !== false;

  if (!supplierDescription) {
    return { ok: false as const, status: 400, error: "Enter the supplier product description." };
  }

  if (price == null || price <= 0) {
    return { ok: false as const, status: 400, error: "The opening price must be greater than zero." };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return { ok: false as const, status: 400, error: "Enter the date this price starts." };
  }

  const { data: invoice } = await access.supabase
    .from("supplier_invoices")
    .select("id, supplier_id")
    .eq("id", invoiceId)
    .maybeSingle();
  const { data: line } = await access.supabase
    .from("supplier_invoice_lines")
    .select("id, review_status")
    .eq("id", lineId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();

  if (!invoice || !line || !invoice.supplier_id) {
    return {
      ok: false as const,
      status: 400,
      error: "Choose the supplier on the invoice before creating a material.",
    };
  }

  const [materials, products] = await Promise.all([
    access.supabase.from("materials").select("identity_key"),
    access.supabase
      .from("material_supplier_products")
      .select("supplier_id, supplier_sku, normalized_description")
      .eq("supplier_id", invoice.supplier_id),
  ]);
  const conflict = invoiceMaterialConflict({
    reviewStatus: line.review_status,
    openingPriceAlreadyCreated: false,
    name: parsed.name,
    category: parsed.category,
    thicknessMm: parsed.thicknessMm,
    colour: parsed.colour,
    finish: parsed.finish,
    purchaseUnit: parsed.purchaseUnit,
    purchaseWidthMm: parsed.purchaseWidthMm,
    purchaseHeightMm: parsed.purchaseHeightMm,
    purchaseLengthMm: parsed.purchaseLengthMm,
    supplierId: invoice.supplier_id,
    supplierSku: supplierSku || null,
    supplierDescription,
    existingIdentityKeys: (materials.data ?? []).map((material) => material.identity_key),
    existingProducts: (products.data ?? []).map((product) => ({
      supplierId: product.supplier_id,
      sku: product.supplier_sku,
      normalizedDescription: product.normalized_description,
    })),
  });

  if (conflict) {
    return { ok: false as const, status: 409, error: conflict };
  }

  const { data, error } = await access.supabase.rpc("create_material_from_invoice_line", {
    p_invoice_line_id: lineId,
    p_name: parsed.name,
    p_category: parsed.category,
    p_thickness_mm: parsed.thicknessMm,
    p_colour: parsed.colour,
    p_finish: parsed.finish,
    p_purchase_unit: parsed.purchaseUnit,
    p_purchase_width_mm: parsed.purchaseWidthMm,
    p_purchase_height_mm: parsed.purchaseHeightMm,
    p_purchase_length_mm: parsed.purchaseLengthMm,
    p_supplier_id: invoice.supplier_id,
    p_supplier_description: supplierDescription,
    p_supplier_sku: supplierSku || null,
    p_price: price,
    p_effective_date: effectiveDate,
    p_preferred: preferred,
  });

  if (error || !data?.materialId) {
    return {
      ok: false as const,
      status: 400,
      error: error?.message ?? "The material could not be created.",
    };
  }

  refreshInvoicePages(invoiceId);
  revalidatePath("/admin/materials");
  revalidatePath(`/admin/materials/${data.materialId}`);
  return { ok: true as const, materialId: data.materialId as string };
}

export async function correctInvoiceSupplier(invoiceId: string, supplierId: string) {
  const access = await requireAdmin();

  if (!access.ok) {
    return access;
  }

  const catalog = await loadInvoiceMatchCatalog(access.supabase);

  if (!catalog.ok) {
    return { ok: false, status: 500, error: catalog.error };
  }

  const supplier = catalog.suppliers.find((item) => item.id === supplierId);

  if (!supplier || isBlockedSupplierName(supplier.name)) {
    return { ok: false, status: 400, error: "Choose a real external supplier." };
  }

  const { data: invoice, error } = await access.supabase
    .from("supplier_invoices")
    .select("id, supplier_id, extraction_status, extraction_warnings, invoice_number, invoice_date")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error || !invoice) {
    return { ok: false, status: 404, error: "Invoice not found." };
  }

  const duplicate = findDuplicateInvoice({
    checksumSha256: "not-the-file",
    supplierId,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    existing: catalog.existingInvoices.filter((item) => item.id !== invoiceId),
  });

  if (duplicate) {
    return { ok: false, status: 409, error: duplicate.reason };
  }

  const { error: updateError } = await access.supabase
    .from("supplier_invoices")
    .update({ supplier_id: supplierId })
    .eq("id", invoiceId);

  if (updateError) {
    return { ok: false, status: 400, error: "The supplier could not be saved." };
  }

  await reclassifyStoredLines(access.supabase, invoiceId, supplierId, catalog);
  await recordEvent(access.supabase, {
    invoiceId,
    actorId: access.userId,
    action: "supplier_corrected",
    metadata: { from: invoice.supplier_id, to: supplierId },
  });
  refreshInvoicePages(invoiceId);
  return { ok: true as const };
}

export async function reviewInvoiceLine(
  invoiceId: string,
  lineId: string,
  body: Record<string, unknown>
) {
  const access = await requireAdmin();

  if (!access.ok) {
    return access;
  }

  const catalog = await loadInvoiceMatchCatalog(access.supabase);

  if (!catalog.ok) {
    return { ok: false, status: 500, error: catalog.error };
  }

  const { data: invoice } = await access.supabase
    .from("supplier_invoices")
    .select("id, supplier_id, extraction_status, extraction_warnings")
    .eq("id", invoiceId)
    .maybeSingle();
  const { data: line } = await access.supabase
    .from("supplier_invoice_lines")
    .select("*")
    .eq("id", lineId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();

  if (!invoice || !line) {
    return { ok: false, status: 404, error: "Invoice line not found." };
  }

  const action = typeof body.action === "string" ? body.action : "correct";

  if (action === "confirm_match") {
    return confirmLineMatch(access, invoice, line, catalog, body);
  }

  if (action === "ignore") {
    return ignoreLine(access, invoice, line, catalog, body);
  }

  if (action === "query") {
    const note = textValue(body.note);

    const { error } = await access.supabase
      .from("supplier_invoice_lines")
      .update({
        review_status: "query",
        internal_note: note || line.internal_note,
      })
      .eq("id", lineId);

    if (error) {
      return { ok: false, status: 400, error: "The query could not be saved." };
    }

    await recordEvent(access.supabase, {
      invoiceId,
      lineId,
      actorId: access.userId,
      action: "line_queried",
      metadata: { note },
    });
    await refreshProcessingStatus(access.supabase, invoiceId);
    refreshInvoicePages(invoiceId);
    return { ok: true as const };
  }

  const reviewed = {
    reviewed_description: textValue(body.description) || null,
    reviewed_supplier_sku: textValue(body.sku) || null,
    reviewed_quantity: numberValue(body.quantity),
    reviewed_unit: textValue(body.unit) || null,
    reviewed_unit_price: numberValue(body.unitPrice),
    reviewed_line_total: numberValue(body.lineTotal),
    internal_note: textValue(body.note) || null,
  };

  if (reviewed.reviewed_quantity != null && reviewed.reviewed_quantity <= 0) {
    return { ok: false, status: 400, error: "Quantity must be greater than zero." };
  }

  if (
    (reviewed.reviewed_unit_price != null && reviewed.reviewed_unit_price <= 0) ||
    (reviewed.reviewed_line_total != null && reviewed.reviewed_line_total <= 0)
  ) {
    return { ok: false, status: 400, error: "Prices must be greater than zero." };
  }

  const classified = classifyInvoiceLine({
    line: toParsedLine(line),
    supplierId: invoice.supplier_id,
    products: catalog.products,
    mappings: catalog.mappings,
    ignoreRules: catalog.ignoreRules,
    description: reviewed.reviewed_description,
    sku: reviewed.reviewed_supplier_sku,
    quantity: reviewed.reviewed_quantity,
    unit: reviewed.reviewed_unit,
    unitPrice: reviewed.reviewed_unit_price,
    lineTotal: reviewed.reviewed_line_total,
  });

  const { error } = await access.supabase
    .from("supplier_invoice_lines")
    .update({
      ...reviewed,
      matched_supplier_product_id: classified.matchedProductId,
      match_confidence: classified.matchConfidence,
      match_method: classified.matchMethod,
      review_status: classified.reviewStatus,
      maths_warning: classified.mathsWarning,
      internal_note: reviewed.internal_note ?? classified.note,
    })
    .eq("id", lineId);

  if (error) {
    return { ok: false, status: 400, error: "The line correction could not be saved." };
  }

  await recordEvent(access.supabase, {
    invoiceId,
    lineId,
    actorId: access.userId,
    action: "line_corrected",
    metadata: {
      before: {
        description: line.raw_description,
        quantity: line.raw_quantity,
        unitPrice: line.raw_unit_price,
      },
      after: reviewed,
    },
  });
  await refreshProcessingStatus(access.supabase, invoiceId);
  refreshInvoicePages(invoiceId);
  return { ok: true as const };
}

export async function addInvoiceLine(
  invoiceId: string,
  body: Record<string, unknown>
) {
  const access = await requireAdmin();

  if (!access.ok) {
    return access;
  }

  const description = textValue(body.description);

  if (!description) {
    return { ok: false, status: 400, error: "Enter the line description from the invoice." };
  }

  const catalog = await loadInvoiceMatchCatalog(access.supabase);

  if (!catalog.ok) {
    return { ok: false, status: 500, error: catalog.error };
  }

  const { data: invoice } = await access.supabase
    .from("supplier_invoices")
    .select("id, supplier_id")
    .eq("id", invoiceId)
    .maybeSingle();
  const { data: existingLines } = await access.supabase
    .from("supplier_invoice_lines")
    .select("line_number")
    .eq("invoice_id", invoiceId);

  if (!invoice) {
    return { ok: false, status: 404, error: "Invoice not found." };
  }

  const lineNumber =
    Math.max(0, ...(existingLines ?? []).map((line) => line.line_number)) + 1;
  const parsed = {
    lineNumber,
    rawDescription: description,
    rawSupplierSku: textValue(body.sku) || null,
    rawQuantity: numberValue(body.quantity),
    rawUnit: textValue(body.unit) || null,
    rawUnitPrice: numberValue(body.unitPrice),
    rawLineTotal: numberValue(body.lineTotal),
    rawTax: null,
  };
  const classified = classifyInvoiceLine({
    line: parsed,
    supplierId: invoice.supplier_id,
    products: catalog.products,
    mappings: catalog.mappings,
    ignoreRules: catalog.ignoreRules,
  });
  const { error } = await access.supabase.from("supplier_invoice_lines").insert({
    invoice_id: invoiceId,
    line_number: lineNumber,
    raw_description: parsed.rawDescription,
    raw_supplier_sku: parsed.rawSupplierSku,
    raw_quantity: parsed.rawQuantity,
    raw_unit: parsed.rawUnit,
    raw_unit_price: parsed.rawUnitPrice,
    raw_line_total: parsed.rawLineTotal,
    matched_supplier_product_id: classified.matchedProductId,
    match_confidence: classified.matchConfidence,
    match_method: classified.matchMethod,
    review_status: classified.reviewStatus,
    maths_warning: classified.mathsWarning,
    internal_note: classified.note,
  });

  if (error) {
    return { ok: false, status: 400, error: "The line could not be added." };
  }

  await recordEvent(access.supabase, {
    invoiceId,
    actorId: access.userId,
    action: "line_added",
    metadata: { lineNumber, description },
  });
  await refreshProcessingStatus(access.supabase, invoiceId);
  refreshInvoicePages(invoiceId);
  return { ok: true as const };
}

async function confirmLineMatch(
  access: { supabase: SupabaseClient; userId: string },
  invoice: { id: string; supplier_id: string | null },
  line: {
    id: string;
    raw_description: string;
    matched_supplier_product_id: string | null;
    raw_supplier_sku: string | null;
    raw_quantity: number | null;
    raw_unit: string | null;
    raw_unit_price: number | null;
    raw_line_total: number | null;
    reviewed_description: string | null;
    reviewed_supplier_sku: string | null;
    reviewed_quantity: number | null;
    reviewed_unit: string | null;
    reviewed_unit_price: number | null;
    reviewed_line_total: number | null;
    line_number: number;
  },
  catalog: Awaited<ReturnType<typeof loadInvoiceMatchCatalog>> & { ok: true },
  body: Record<string, unknown>
) {
  if (!invoice.supplier_id) {
    return { ok: false as const, status: 400, error: "Choose the supplier before matching a product." };
  }

  const productId = textValue(body.productId);
  const product = catalog.products.find(
    (item) => item.id === productId && item.supplierId === invoice.supplier_id
  );

  if (!product) {
    return { ok: false as const, status: 400, error: "Choose a product from this supplier." };
  }

  const description = line.raw_description;
  const normalized = normalizeSupplierDescription(description);
  const reviewed = {
    reviewed_description: textValue(body.description) || null,
    reviewed_supplier_sku: textValue(body.sku) || null,
    reviewed_quantity: numberValue(body.quantity),
    reviewed_unit: textValue(body.unit) || null,
    reviewed_unit_price: numberValue(body.unitPrice),
    reviewed_line_total: numberValue(body.lineTotal),
    internal_note: textValue(body.note) || null,
  };
  const { error: mappingError } = await access.supabase
    .from("supplier_product_description_mappings")
    .upsert(
      {
        supplier_id: invoice.supplier_id,
        display_description: description,
        normalized_description: normalized,
        material_supplier_product_id: product.id,
        created_by: access.userId,
        created_from_invoice_line_id: line.id,
      },
      { onConflict: "supplier_id,normalized_description" }
    );

  if (mappingError) {
    return { ok: false as const, status: 400, error: "The description mapping could not be saved." };
  }

  const classified = classifyInvoiceLine({
    line: toParsedLine(line),
    supplierId: invoice.supplier_id,
    products: catalog.products,
    mappings: [
      ...catalog.mappings.filter(
        (mapping) =>
          !(
            mapping.supplierId === invoice.supplier_id &&
            mapping.normalizedDescription === normalized
          )
      ),
      {
        supplierId: invoice.supplier_id,
        normalizedDescription: normalized,
        productId: product.id,
      },
    ],
    ignoreRules: catalog.ignoreRules,
    forcedProductId: product.id,
    forcedMethod: "mapping",
    description: reviewed.reviewed_description ?? line.raw_description,
    sku: reviewed.reviewed_supplier_sku ?? line.raw_supplier_sku,
    quantity: reviewed.reviewed_quantity ?? line.raw_quantity,
    unit: reviewed.reviewed_unit ?? line.raw_unit,
    unitPrice: reviewed.reviewed_unit_price ?? line.raw_unit_price,
    lineTotal: reviewed.reviewed_line_total ?? line.raw_line_total,
  });
  const { error } = await access.supabase
    .from("supplier_invoice_lines")
    .update({
      ...reviewed,
      matched_supplier_product_id: classified.matchedProductId,
      match_confidence: classified.matchConfidence,
      match_method: classified.matchMethod,
      review_status: classified.reviewStatus,
      maths_warning: classified.mathsWarning,
      internal_note: reviewed.internal_note ?? classified.note,
    })
    .eq("id", line.id);

  if (error) {
    return { ok: false as const, status: 400, error: "The product match could not be saved." };
  }

  const changed = line.matched_supplier_product_id && line.matched_supplier_product_id !== product.id;
  await recordEvent(access.supabase, {
    invoiceId: invoice.id,
    lineId: line.id,
    actorId: access.userId,
    action: changed ? "product_match_changed" : "product_match_confirmed",
    metadata: {
      from: line.matched_supplier_product_id,
      to: product.id,
      description,
    },
  });
  await recordEvent(access.supabase, {
    invoiceId: invoice.id,
    lineId: line.id,
    actorId: access.userId,
    action: "description_mapping_created",
    metadata: { description, productId: product.id },
  });
  await refreshProcessingStatus(access.supabase, invoice.id);
  refreshInvoicePages(invoice.id);
  return { ok: true as const };
}

async function ignoreLine(
  access: { supabase: SupabaseClient; userId: string },
  invoice: { id: string; supplier_id: string | null },
  line: { id: string; raw_description: string },
  catalog: Awaited<ReturnType<typeof loadInvoiceMatchCatalog>> & { ok: true },
  body: Record<string, unknown>
) {
  const remember = body.remember === true;
  const note = textValue(body.note) || "Not a production material.";

  if (remember && !invoice.supplier_id) {
    return {
      ok: false as const,
      status: 400,
      error: "Choose the supplier before remembering an ignored description.",
    };
  }

  if (remember && invoice.supplier_id) {
    const { error: ruleError } = await access.supabase
      .from("supplier_invoice_ignore_rules")
      .upsert(
        {
          supplier_id: invoice.supplier_id,
          display_description: line.raw_description,
          normalized_description: normalizeSupplierDescription(line.raw_description),
          created_by: access.userId,
          created_from_invoice_line_id: line.id,
        },
        { onConflict: "supplier_id,normalized_description" }
      );

    if (ruleError) {
      return { ok: false as const, status: 400, error: "The ignore rule could not be saved." };
    }

    await recordEvent(access.supabase, {
      invoiceId: invoice.id,
      lineId: line.id,
      actorId: access.userId,
      action: "ignore_rule_created",
      metadata: { description: line.raw_description },
    });
  }

  const { error } = await access.supabase
    .from("supplier_invoice_lines")
    .update({
      review_status: "ignored",
      matched_supplier_product_id: null,
      match_confidence: null,
      match_method: null,
      internal_note: note,
    })
    .eq("id", line.id);

  if (error) {
    return { ok: false as const, status: 400, error: "The line could not be ignored." };
  }

  await recordEvent(access.supabase, {
    invoiceId: invoice.id,
    lineId: line.id,
    actorId: access.userId,
    action: "line_ignored",
    metadata: { remember, note },
  });
  await refreshProcessingStatus(access.supabase, invoice.id);
  refreshInvoicePages(invoice.id);
  return { ok: true as const, catalogSize: catalog.products.length };
}

async function reclassifyStoredLines(
  supabase: SupabaseClient,
  invoiceId: string,
  supplierId: string,
  catalog: Awaited<ReturnType<typeof loadInvoiceMatchCatalog>> & { ok: true }
) {
  const { data: lines } = await supabase
    .from("supplier_invoice_lines")
    .select("*")
    .eq("invoice_id", invoiceId);

  for (const line of lines ?? []) {
    if (line.review_status === "query") {
      continue;
    }

    const classified = classifyInvoiceLine({
      line: toParsedLine(line),
      supplierId,
      products: catalog.products,
      mappings: catalog.mappings,
      ignoreRules: catalog.ignoreRules,
      description: line.reviewed_description,
      sku: line.reviewed_supplier_sku,
      quantity: line.reviewed_quantity,
      unit: line.reviewed_unit,
      unitPrice: line.reviewed_unit_price,
      lineTotal: line.reviewed_line_total,
    });

    await supabase
      .from("supplier_invoice_lines")
      .update({
        matched_supplier_product_id: classified.matchedProductId,
        match_confidence: classified.matchConfidence,
        match_method: classified.matchMethod,
        review_status: classified.reviewStatus,
        maths_warning: classified.mathsWarning,
      })
      .eq("id", line.id);
  }

  await refreshProcessingStatus(supabase, invoiceId);
}

async function refreshProcessingStatus(supabase: SupabaseClient, invoiceId: string) {
  const { data: invoice } = await supabase
    .from("supplier_invoices")
    .select("extraction_status, extraction_warnings")
    .eq("id", invoiceId)
    .maybeSingle();
  const { data: lines } = await supabase
    .from("supplier_invoice_lines")
    .select("review_status")
    .eq("invoice_id", invoiceId);

  if (!invoice) {
    return;
  }

  const processingStatus = deriveProcessingStatus({
    extractionStatus: invoice.extraction_status,
    warnings: Array.isArray(invoice.extraction_warnings)
      ? invoice.extraction_warnings.filter((item): item is string => typeof item === "string")
      : [],
    lineStatuses: (lines ?? []).map((line) => line.review_status as InvoiceReviewStatus),
  });

  await supabase
    .from("supplier_invoices")
    .update({ processing_status: processingStatus })
    .eq("id", invoiceId);
}

async function recordEvent(
  supabase: SupabaseClient,
  input: {
    invoiceId: string;
    lineId?: string;
    actorId: string;
    action: string;
    metadata: Record<string, unknown>;
  }
) {
  await supabase.from("supplier_invoice_events").insert({
    invoice_id: input.invoiceId,
    invoice_line_id: input.lineId ?? null,
    actor_id: input.actorId,
    action: input.action,
    metadata: input.metadata,
  });
}

function toParsedLine(line: {
  line_number: number;
  raw_description: string;
  raw_supplier_sku: string | null;
  raw_quantity: number | string | null;
  raw_unit: string | null;
  raw_unit_price: number | string | null;
  raw_line_total: number | string | null;
  raw_tax?: number | string | null;
}) {
  return {
    lineNumber: line.line_number,
    rawDescription: line.raw_description,
    rawSupplierSku: line.raw_supplier_sku,
    rawQuantity: numberValue(line.raw_quantity),
    rawUnit: line.raw_unit,
    rawUnitPrice: numberValue(line.raw_unit_price),
    rawLineTotal: numberValue(line.raw_line_total),
    rawTax: numberValue(line.raw_tax),
  };
}

function resolveMimeType(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const fromName = MIME_BY_EXTENSION[extension];

  if (!fromName) {
    return null;
  }

  if (file.type && file.type !== fromName && file.type !== "application/octet-stream") {
    return null;
  }

  return fromName;
}

function safeFileName(fileName: string) {
  const cleaned = fileName
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();

  return cleaned || "invoice";
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
