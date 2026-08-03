import type { InvoiceDraftStatus } from "@/lib/invoice/constants";

export type InvoiceDisplayStatus =
  | "draft"
  | "needs_pricing"
  | "ready_for_review"
  | "ready_for_xero"
  | "pushed_to_xero"
  | "invoiced"
  | "cancelled";

export const INVOICE_DISPLAY_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  draft: "Draft",
  needs_pricing: "Needs pricing",
  ready_for_review: "Ready for review",
  ready_for_xero: "Ready for Xero",
  pushed_to_xero: "Pushed to Xero",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

export function deriveInvoiceDisplayStatus(input: {
  status: InvoiceDraftStatus;
  unpricedCount: number;
}): InvoiceDisplayStatus {
  if (input.status === "cancelled") {
    return "cancelled";
  }

  if (input.status === "invoiced") {
    return "invoiced";
  }

  if (input.status === "pushed_to_xero") {
    return "pushed_to_xero";
  }

  if (input.status === "approved") {
    return "ready_for_xero";
  }

  if (input.status === "needs_pricing" || input.unpricedCount > 0) {
    return "needs_pricing";
  }

  if (input.status === "ready_for_review") {
    return "ready_for_review";
  }

  return "draft";
}

export function invoiceDisplayStatusNeedsAttention(displayStatus: InvoiceDisplayStatus) {
  return (
    displayStatus === "needs_pricing" ||
    displayStatus === "ready_for_review" ||
    displayStatus === "ready_for_xero"
  );
}
