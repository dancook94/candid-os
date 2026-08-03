import type {
  InvoiceDraftStatus,
  PricingSource,
} from "@/lib/invoice/constants";
import type { InvoiceDisplayStatus } from "@/lib/invoice/display-status";
import type { InvoiceApprovalReadiness } from "@/lib/invoice/validation";
import type { ManifestBillingStatus } from "@/lib/manifest/constants";
import type { ManifestItemRecord } from "@/lib/manifest/types";

export type InvoiceDraftRecord = {
  id: string;
  job_id: string;
  company_id: string;
  quote_id: string | null;
  status: InvoiceDraftStatus;
  currency: string;
  subtotal: number;
  tax_total: number;
  total: number;
  purchase_order_number: string | null;
  internal_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  xero_invoice_id: string | null;
  xero_invoice_number: string | null;
  xero_status: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceItemRecord = {
  id: string;
  invoice_draft_id: string;
  job_id: string;
  production_item_id: string | null;
  quote_item_id: string | null;
  item_name: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number | null;
  line_total: number;
  tax_rate: number;
  billing_status: ManifestBillingStatus;
  pricing_source: PricingSource;
  pricing_note: string | null;
  manually_edited: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type InvoiceLineView = InvoiceItemRecord & {
  sourceLabel: string;
  canResetFromSource: boolean;
};

export type InvoiceTotalGroup = {
  subtotal: number;
  tax_total: number;
  total: number;
};

export type InvoiceTotalGroups = {
  originalQuote: InvoiceTotalGroup;
  productionChanges: InvoiceTotalGroup;
  finalInvoice: InvoiceTotalGroup;
};

export type QuoteTotalAudit = {
  beforeCancellations: InvoiceTotalGroup;
  cancellations: InvoiceTotalGroup;
  adjustedOriginal: InvoiceTotalGroup;
};

export type InvoiceReviewData = {
  draft: InvoiceDraftRecord;
  invoiceItems: InvoiceItemRecord[];
  manifestItems: ManifestItemRecord[];
  quotedItems: ManifestItemRecord[];
  productionChanges: ManifestItemRecord[];
  finalLines: InvoiceLineView[];
  unpricedCount: number;
  canApprove: boolean;
  approvalReadiness: InvoiceApprovalReadiness;
  displayStatus: InvoiceDisplayStatus;
  productionChangedAfterApproval: boolean;
  isApproved: boolean;
  totalGroups: InvoiceTotalGroups;
  quoteAudit: QuoteTotalAudit;
  schemaMissing: boolean;
  error: string | null;
};

export type InvoiceItemUpdateInput = {
  itemName?: string;
  description?: string | null;
  quantity?: number;
  unit?: string | null;
  unitPrice?: number | null;
  taxRate?: number;
  billingStatus?: ManifestBillingStatus;
  pricingSource?: PricingSource;
  pricingNote?: string | null;
  manuallyEdited?: boolean;
};

export type XeroPayloadPreview = {
  contactName: string;
  jobReference: string;
  quoteReference: string | null;
  purchaseOrderNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  lineItems: Array<{
    itemName: string;
    description: string;
    quantity: number;
    unitAmount: number;
    taxRate: number;
    lineTotal: number;
  }>;
  subtotal: number;
  taxTotal: number;
  total: number;
};
