export const INVOICE_DRAFT_STATUSES = [
  "draft",
  "needs_pricing",
  "ready_for_review",
  "approved",
  "pushed_to_xero",
  "invoiced",
  "cancelled",
] as const;

export type InvoiceDraftStatus = (typeof INVOICE_DRAFT_STATUSES)[number];

export const INVOICE_DRAFT_STATUS_LABELS: Record<InvoiceDraftStatus, string> = {
  draft: "Draft",
  needs_pricing: "Needs pricing",
  ready_for_review: "Ready for review",
  approved: "Approved",
  pushed_to_xero: "Pushed to Xero",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

export const PRICING_SOURCES = [
  "accepted_quote",
  "manual",
  "calculator",
  "customer_price_rule",
  "printfactory_cost",
  "included",
  "no_charge",
] as const;

export type PricingSource = (typeof PRICING_SOURCES)[number];

export const PRICING_SOURCE_LABELS: Record<PricingSource, string> = {
  accepted_quote: "Accepted quote",
  manual: "Manual",
  calculator: "Calculator",
  customer_price_rule: "Customer price rule",
  printfactory_cost: "PrintFactory cost",
  included: "Included",
  no_charge: "No charge",
};

export const JOB_COMMERCIAL_STATUSES = [
  "not_ready",
  "invoice_review",
  "ready_for_xero",
  "pushed_to_xero",
  "invoiced",
] as const;

export type JobCommercialStatus = (typeof JOB_COMMERCIAL_STATUSES)[number];

export const JOB_COMMERCIAL_STATUS_LABELS: Record<JobCommercialStatus, string> = {
  not_ready: "Not ready",
  invoice_review: "Invoice review",
  ready_for_xero: "Ready for Xero",
  pushed_to_xero: "Pushed to Xero",
  invoiced: "Invoiced",
};

export const INVOICE_ACTIVITY_TYPES = {
  invoiceDraftCreated: "invoice_draft_created",
  invoiceDraftReconciled: "invoice_draft_reconciled",
  invoiceItemPriced: "invoice_item_priced",
  invoiceDraftApproved: "invoice_draft_approved",
} as const;

export const INVOICE_DRAFT_SELECT =
  "id, job_id, company_id, quote_id, status, currency, subtotal, tax_total, total, purchase_order_number, internal_note, approved_by, approved_at, xero_invoice_id, xero_invoice_number, xero_status, created_at, updated_at";

export const INVOICE_ITEM_SELECT =
  "id, invoice_draft_id, job_id, production_item_id, quote_item_id, item_name, description, quantity, unit, unit_price, line_total, tax_rate, billing_status, pricing_source, pricing_note, manually_edited, created_at, updated_at, deleted_at";

export const NON_INVOICE_BILLING_STATUSES = [
  "cancelled",
  "no_charge",
  "reprint_no_charge",
  "included",
] as const;

export const UNPRICED_BILLING_STATUSES = ["price_required"] as const;
