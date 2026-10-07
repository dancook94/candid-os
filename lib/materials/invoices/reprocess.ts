import type { SupabaseClient } from "@supabase/supabase-js";

import { findDuplicateInvoice } from "@/lib/materials/invoices/duplicate";
import { buildInvoiceDraft } from "@/lib/materials/invoices/draft";
import { extractInvoiceDocument } from "@/lib/materials/invoices/extract";
import { SUPPLIER_INVOICE_FILES_BUCKET } from "@/lib/materials/invoices/model";
import { recordPriceChangeDetections } from "@/lib/materials/invoices/price-change-events";
import { loadInvoiceMatchCatalog } from "@/lib/materials/invoices/queries";
import { findInvoiceReprocessBlock } from "@/lib/materials/invoices/reprocess-guard";

export async function rebuildStoredInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  actorId: string | null
) {
  const catalog = await loadInvoiceMatchCatalog(supabase);

  if (!catalog.ok) {
    return { ok: false as const, status: 500, error: catalog.error };
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("supplier_invoices")
    .select("id, source_type")
    .eq("id", invoiceId)
    .maybeSingle();
  const { data: file, error: fileError } = await supabase
    .from("supplier_invoice_files")
    .select("storage_path, mime_type, checksum_sha256")
    .eq("invoice_id", invoiceId)
    .maybeSingle();

  if (invoiceError || fileError || !invoice || !file) {
    return { ok: false as const, status: 404, error: "The stored invoice could not be read." };
  }

  const reprocessBlock = await findInvoiceReprocessBlock(supabase, invoiceId);

  if (reprocessBlock) {
    return { ok: false as const, status: 409, error: reprocessBlock };
  }

  const downloaded = await supabase.storage
    .from(SUPPLIER_INVOICE_FILES_BUCKET)
    .download(file.storage_path);

  if (downloaded.error || !downloaded.data) {
    return { ok: false as const, status: 404, error: "The original invoice file could not be read." };
  }

  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const extracted = await extractInvoiceDocument({
    bytes,
    mimeType: file.mime_type,
  });
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
  const duplicate = findDuplicateInvoice({
    checksumSha256: file.checksum_sha256,
    supplierId: draft.supplierId,
    invoiceNumber: draft.invoiceNumber,
    invoiceDate: draft.invoiceDate,
    existing: catalog.existingInvoices,
  });

  if (duplicate && duplicate.invoiceId !== invoiceId) {
    return {
      ok: false as const,
      status: 409,
      error: "Another stored invoice already uses this supplier and invoice number.",
    };
  }

  const { count: previousLineCount } = await supabase
    .from("supplier_invoice_lines")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId);
  const { error: deleteError } = await supabase
    .from("supplier_invoice_lines")
    .delete()
    .eq("invoice_id", invoiceId);

  if (deleteError) {
    return { ok: false as const, status: 400, error: "The previous extraction could not be replaced." };
  }

  const { error: updateError } = await supabase
    .from("supplier_invoices")
    .update({
      supplier_id: draft.supplierId,
      raw_supplier_name: draft.rawSupplierName,
      invoice_number: draft.invoiceNumber,
      invoice_date: draft.invoiceDate,
      subtotal: draft.subtotal,
      vat: draft.vat,
      total: draft.total,
      extraction_status: draft.extractionStatus,
      processing_status: draft.processingStatus,
      extraction_warnings: draft.warnings,
    })
    .eq("id", invoiceId);

  if (updateError) {
    return { ok: false as const, status: 400, error: "The invoice header could not be updated." };
  }

  if (draft.lines.length > 0) {
    const { error: lineError } = await supabase.from("supplier_invoice_lines").insert(
      draft.lines.map((line) => ({
        invoice_id: invoiceId,
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
      return { ok: false as const, status: 400, error: "The invoice lines could not be stored." };
    }

    const { data: storedLines } = await supabase
      .from("supplier_invoice_lines")
      .select("id, line_number, review_status, matched_supplier_product_id")
      .eq("invoice_id", invoiceId);

    await recordPriceChangeDetections(supabase, {
      invoiceId,
      actorId,
      invoiceDate: draft.invoiceDate,
      lines: (storedLines ?? []).map((line) => {
        const classified = draft.lines.find((item) => item.lineNumber === line.line_number);
        return {
          id: line.id,
          previousStatus: null,
          reviewStatus: line.review_status,
          productId: line.matched_supplier_product_id,
          comparison: classified?.comparison ?? null,
        };
      }),
    });
  }

  await supabase.from("supplier_invoice_events").insert({
    invoice_id: invoiceId,
    actor_id: actorId,
    action: draft.extractionStatus === "extracted" ? "extraction_completed" : "extraction_failed",
    metadata: {
      reprocessed: true,
      extractionStatus: draft.extractionStatus,
      previousLineCount: previousLineCount ?? 0,
      lineCount: draft.lines.length,
      warnings: draft.warnings,
    },
  });

  return {
    ok: true as const,
    invoiceId,
    lineCount: draft.lines.length,
    invoiceNumber: draft.invoiceNumber,
  };
}
