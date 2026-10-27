export const GMAIL_PROMOTION_BATCH_LIMIT = 10;
export const PYRAMID_SUPPLIER_NAME = "Pyramid Display Materials";

export type PromotionBlock = {
  kind: "already_promoted" | "checksum" | "invoice_number";
  invoiceId: string | null;
  detail: string;
};

export type DocumentQueue = "automatic" | "manual" | "excluded";

export type PromotionPreviewRow = {
  itemId: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  filename: string;
  pyramid: boolean;
  duplicate: PromotionBlock | null;
  selectable: boolean;
  queue?: DocumentQueue;
  queueReason?: string;
};

export type PromotionOutcome = {
  itemId: string;
  filename: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  outcome: "promoted" | "duplicate" | "skipped" | "failed";
  invoiceId: string | null;
  extractionFailed: boolean;
  detail: string;
  supplierId?: string | null;
};

export type PromotionReport = {
  promoted: number;
  duplicate: number;
  skipped: number;
  failed: number;
  results: PromotionOutcome[];
};

export function selectPyramidPilot(rows: readonly PromotionPreviewRow[], limit = GMAIL_PROMOTION_BATCH_LIMIT) {
  return rows
    .filter((row) => row.pyramid && row.selectable)
    .slice(0, limit)
    .map((row) => row.itemId);
}
