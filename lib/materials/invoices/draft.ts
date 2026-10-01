import { classifyInvoiceLine, deriveProcessingStatus } from "@/lib/materials/invoices/match";
import { parseInvoiceText } from "@/lib/materials/invoices/parse";
import { resolveInvoiceSupplier } from "@/lib/materials/invoices/supplier";
import type {
  DescriptionMappingRef,
  IgnoreRuleRef,
  InvoiceAliasRef,
  InvoiceDraft,
  InvoiceExtractionStatus,
  InvoiceMatchProduct,
  InvoiceSupplierRef,
  ParsedInvoiceLine,
} from "@/lib/materials/invoices/model";

export function buildInvoiceDraft(input: {
  text: string | null;
  extractionStatus: InvoiceExtractionStatus;
  extractionWarnings?: string[];
  suppliers: readonly InvoiceSupplierRef[];
  aliases: readonly InvoiceAliasRef[];
  products: readonly InvoiceMatchProduct[];
  mappings: readonly DescriptionMappingRef[];
  ignoreRules: readonly IgnoreRuleRef[];
}): InvoiceDraft {
  const warnings = [...(input.extractionWarnings ?? [])];

  if (input.extractionStatus !== "extracted" || !input.text) {
    return {
      rawSupplierName: null,
      supplierId: null,
      supplierName: null,
      supplierWarning: null,
      invoiceNumber: null,
      invoiceDate: null,
      subtotal: null,
      vat: null,
      total: null,
      extractionStatus: input.extractionStatus,
      processingStatus: "extraction_error",
      warnings:
        warnings.length > 0
          ? warnings
          : ["The invoice text could not be read. No lines were invented."],
      lines: [],
    };
  }

  const parsed = parseInvoiceText(input.text);
  const supplier = resolveInvoiceSupplier(
    parsed.rawSupplierName,
    input.text,
    input.suppliers,
    input.aliases
  );
  const lines = parsed.lines.map((line) =>
    classifyInvoiceLine({
      line,
      supplierId: supplier.supplierId,
      products: input.products,
      mappings: input.mappings,
      ignoreRules: input.ignoreRules,
    })
  );

  if (supplier.warning) {
    warnings.push(supplier.warning);
  }

  warnings.push(...parsed.warnings);

  return {
    rawSupplierName: parsed.rawSupplierName,
    supplierId: supplier.supplierId,
    supplierName: supplier.supplierName,
    supplierWarning: supplier.warning,
    invoiceNumber: parsed.invoiceNumber,
    invoiceDate: parsed.invoiceDate,
    subtotal: parsed.subtotal,
    vat: parsed.vat,
    total: parsed.total,
    extractionStatus: "extracted",
    processingStatus: deriveProcessingStatus({
      extractionStatus: "extracted",
      warnings,
      lineStatuses: lines.map((line) => line.reviewStatus),
    }),
    warnings,
    lines,
  };
}

export function reclassifyLine(input: {
  line: ParsedInvoiceLine;
  supplierId: string | null;
  products: readonly InvoiceMatchProduct[];
  mappings: readonly DescriptionMappingRef[];
  ignoreRules: readonly IgnoreRuleRef[];
  description?: string | null;
  sku?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
}) {
  return classifyInvoiceLine(input);
}
