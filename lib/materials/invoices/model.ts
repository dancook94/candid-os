import type { PurchaseUnit } from "@/lib/materials/units";

export const SUPPLIER_INVOICE_FILES_BUCKET = "supplier-invoice-files";

export const INVOICE_REVIEW_STATUSES = [
  "processed",
  "price_change",
  "needs_review",
  "unmatched",
  "ignored",
  "query",
  "extraction_error",
] as const;

export type InvoiceReviewStatus = (typeof INVOICE_REVIEW_STATUSES)[number];

export const INVOICE_PROCESSING_STATUSES = [
  "needs_review",
  "price_change",
  "unmatched",
  "extraction_error",
  "processed",
  "ignored",
] as const;

export type InvoiceProcessingStatus = (typeof INVOICE_PROCESSING_STATUSES)[number];

export type InvoiceExtractionStatus = "extracted" | "failed" | "needs_ocr";

export type MatchConfidence = "high" | "medium" | "low";

export type MatchMethod =
  | "sku"
  | "description"
  | "mapping"
  | "specification"
  | "fuzzy"
  | "manual";

export type InvoiceSupplierRef = {
  id: string;
  name: string;
  normalizedName: string;
};

export type InvoiceAliasRef = {
  supplierId: string;
  alias: string;
  normalizedAlias: string;
};

export type InvoiceMatchProduct = {
  id: string;
  supplierId: string;
  sku: string | null;
  description: string;
  materialName: string;
  purchaseUnit: PurchaseUnit;
  thicknessMm: number | null;
  colour: string | null;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
  currentPrice: number | null;
  currentPriceUnit: PurchaseUnit | null;
};

export type DescriptionMappingRef = {
  supplierId: string;
  normalizedDescription: string;
  productId: string;
};

export type IgnoreRuleRef = {
  supplierId: string;
  normalizedDescription: string;
};

export type ParsedInvoiceLine = {
  lineNumber: number;
  rawDescription: string;
  rawSupplierSku: string | null;
  rawQuantity: number | null;
  rawUnit: string | null;
  rawUnitPrice: number | null;
  rawLineTotal: number | null;
  rawTax: number | null;
};

export type ParsedInvoice = {
  rawSupplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  lines: ParsedInvoiceLine[];
  warnings: string[];
};

export type PriceComparison = {
  currentPrice: number;
  invoicePrice: number;
  difference: number;
  percent: number;
  priceUnit: PurchaseUnit;
};

export type ClassifiedLine = {
  lineNumber: number;
  rawDescription: string;
  rawSupplierSku: string | null;
  rawQuantity: number | null;
  rawUnit: string | null;
  rawUnitPrice: number | null;
  rawLineTotal: number | null;
  rawTax: number | null;
  matchedProductId: string | null;
  matchConfidence: MatchConfidence | null;
  matchMethod: MatchMethod | null;
  reviewStatus: InvoiceReviewStatus;
  mathsWarning: string | null;
  comparison: PriceComparison | null;
  note: string | null;
};

export type InvoiceDraft = {
  rawSupplierName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierWarning: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  extractionStatus: InvoiceExtractionStatus;
  processingStatus: InvoiceProcessingStatus;
  warnings: string[];
  lines: ClassifiedLine[];
};

export const REVIEW_STATUS_LABELS: Record<InvoiceReviewStatus, string> = {
  processed: "Matched",
  price_change: "Price change",
  needs_review: "Needs review",
  unmatched: "Unmatched",
  ignored: "Ignored",
  query: "Query",
  extraction_error: "Extraction error",
};

export const PROCESSING_STATUS_LABELS: Record<InvoiceProcessingStatus, string> = {
  needs_review: "Needs review",
  price_change: "Price change",
  unmatched: "Unmatched",
  extraction_error: "Extraction error",
  processed: "Processed",
  ignored: "Ignored",
};
