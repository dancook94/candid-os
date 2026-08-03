import { NON_INVOICE_BILLING_STATUSES } from "@/lib/invoice/constants";
import type { InvoiceItemRecord } from "@/lib/invoice/types";
import {
  calculateInvoiceDraftTotals,
  calculateInvoiceLineTotals,
  normalizeInvoiceItemNumericFields,
  roundMoney,
} from "@/lib/invoice/money";
import { getBillableInvoiceLines } from "@/lib/invoice/validation";
import type { ManifestItemRecord } from "@/lib/manifest/types";

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

const NON_INVOICE_SOURCE_TYPES = new Set(["test", "internal"]);

export function shouldIncludeManifestItemInInvoice(manifestItem: ManifestItemRecord) {
  if (manifestItem.production_requirement_status === "cancelled") {
    return false;
  }

  if (NON_INVOICE_SOURCE_TYPES.has(manifestItem.source_type)) {
    return false;
  }

  return !NON_INVOICE_BILLING_STATUSES.includes(
    manifestItem.billing_status as (typeof NON_INVOICE_BILLING_STATUSES)[number]
  );
}

export function isActiveQuotedManifestItem(manifestItem: ManifestItemRecord) {
  return (
    manifestItem.source_type === "quoted" &&
    shouldIncludeManifestItemInInvoice(manifestItem)
  );
}

export function isOriginalQuoteInvoiceLine(
  line: InvoiceItemRecord,
  manifestItem?: ManifestItemRecord | null
) {
  if (manifestItem?.source_type === "quoted") {
    return true;
  }

  return line.pricing_source === "accepted_quote" && Boolean(line.quote_item_id);
}

export function isProductionChangeInvoiceLine(
  line: InvoiceItemRecord,
  manifestItem?: ManifestItemRecord | null
) {
  return !isOriginalQuoteInvoiceLine(line, manifestItem);
}

function totalsFromInvoiceLines(lines: InvoiceItemRecord[]): InvoiceTotalGroup {
  let subtotal = 0;
  let taxTotal = 0;

  for (const line of lines.map(normalizeInvoiceItemNumericFields)) {
    const totals = calculateInvoiceLineTotals({
      quantity: line.quantity,
      unitPrice: line.unit_price,
      taxRate: line.tax_rate,
    });
    subtotal += totals.netTotal;
    taxTotal += totals.vatAmount;
  }

  return {
    subtotal: roundMoney(subtotal),
    tax_total: roundMoney(taxTotal),
    total: roundMoney(subtotal + taxTotal),
  };
}

export function calculateInvoiceTotalGroups(
  items: InvoiceItemRecord[],
  manifestById?: Map<string, ManifestItemRecord>
): InvoiceTotalGroups {
  const billableLines = getBillableInvoiceLines(items).map(normalizeInvoiceItemNumericFields);

  const originalLines = billableLines.filter((line) => {
    const manifestItem = line.production_item_id
      ? manifestById?.get(line.production_item_id) ?? null
      : null;
    return isOriginalQuoteInvoiceLine(line, manifestItem);
  });

  const changeLines = billableLines.filter((line) => {
    const manifestItem = line.production_item_id
      ? manifestById?.get(line.production_item_id) ?? null
      : null;
    return isProductionChangeInvoiceLine(line, manifestItem);
  });

  const originalQuote = totalsFromInvoiceLines(originalLines);
  const productionChanges = totalsFromInvoiceLines(changeLines);
  const finalInvoice = calculateInvoiceDraftTotals(items);

  return {
    originalQuote,
    productionChanges,
    finalInvoice,
  };
}

function manifestItemToSyntheticInvoiceLine(
  manifestItem: ManifestItemRecord
): InvoiceItemRecord {
  const quantity = manifestItem.quantity ?? manifestItem.quoted_quantity ?? 1;
  const unitPrice = manifestItem.quote_unit_price;
  const billingStatus =
    unitPrice === null ? ("price_required" as const) : manifestItem.billing_status;

  return normalizeInvoiceItemNumericFields({
    id: manifestItem.id,
    invoice_draft_id: "",
    job_id: manifestItem.job_id,
    production_item_id: manifestItem.id,
    quote_item_id: manifestItem.quote_item_id,
    item_name: manifestItem.item_name,
    description: manifestItem.description,
    quantity,
    unit: manifestItem.unit,
    unit_price: unitPrice,
    line_total: 0,
    tax_rate: 20,
    billing_status: billingStatus,
    pricing_source: "accepted_quote",
    pricing_note: null,
    manually_edited: false,
    created_at: manifestItem.created_at,
    updated_at: manifestItem.updated_at,
    deleted_at: null,
  });
}

export function calculateQuoteTotalAudit(
  manifestItems: ManifestItemRecord[]
): QuoteTotalAudit {
  const quotedItems = manifestItems.filter((item) => item.source_type === "quoted");
  const activeQuoted = quotedItems.filter(isActiveQuotedManifestItem);
  const cancelledQuoted = quotedItems.filter(
    (item) =>
      item.billing_status === "cancelled" ||
      item.production_requirement_status === "cancelled"
  );

  const beforeCancellations = totalsFromInvoiceLines(
    quotedItems.map(manifestItemToSyntheticInvoiceLine)
  );
  const cancellations = totalsFromInvoiceLines(
    cancelledQuoted.map(manifestItemToSyntheticInvoiceLine)
  );
  const adjustedOriginal = totalsFromInvoiceLines(
    activeQuoted.map(manifestItemToSyntheticInvoiceLine)
  );

  return {
    beforeCancellations,
    cancellations,
    adjustedOriginal,
  };
}

export function findMissingQuotedInvoiceLines(input: {
  manifestItems: ManifestItemRecord[];
  invoiceItems: InvoiceItemRecord[];
}) {
  const activeQuoted = input.manifestItems.filter(isActiveQuotedManifestItem);
  const invoiceProductionIds = new Set(
    input.invoiceItems
      .filter((line) => !line.deleted_at && line.production_item_id)
      .map((line) => line.production_item_id as string)
  );

  return activeQuoted.filter((item) => !invoiceProductionIds.has(item.id));
}
