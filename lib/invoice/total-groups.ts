import { NON_INVOICE_BILLING_STATUSES } from "@/lib/invoice/constants";
import type { InvoiceItemRecord } from "@/lib/invoice/types";
import {
  acceptedQuoteLineToSyntheticInvoiceLine,
  buildManifestByQuoteItemId,
  isActiveAcceptedQuoteLine,
  isQuoteItemCancelled,
  type AcceptedQuoteLine,
} from "@/lib/invoice/quote-lines";
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

export function calculateQuoteTotalAudit(input: {
  quoteItems: AcceptedQuoteLine[];
  manifestItems: ManifestItemRecord[];
  taxRatePercent: number;
}): QuoteTotalAudit {
  const billableQuoteItems = input.quoteItems.filter((item) => !item.is_optional);
  const manifestByQuoteItemId = buildManifestByQuoteItemId(input.manifestItems);

  const beforeCancellations = totalsFromInvoiceLines(
    billableQuoteItems.map((quoteItem) =>
      acceptedQuoteLineToSyntheticInvoiceLine(quoteItem, input.taxRatePercent)
    )
  );

  const cancelledQuoteItems = billableQuoteItems.filter((quoteItem) =>
    isQuoteItemCancelled(quoteItem.id, manifestByQuoteItemId)
  );

  const cancellations = totalsFromInvoiceLines(
    cancelledQuoteItems.map((quoteItem) =>
      acceptedQuoteLineToSyntheticInvoiceLine(quoteItem, input.taxRatePercent)
    )
  );

  const activeQuoteItems = billableQuoteItems.filter((quoteItem) =>
    isActiveAcceptedQuoteLine(quoteItem, manifestByQuoteItemId)
  );

  const adjustedOriginal = totalsFromInvoiceLines(
    activeQuoteItems.map((quoteItem) =>
      acceptedQuoteLineToSyntheticInvoiceLine(quoteItem, input.taxRatePercent)
    )
  );

  return {
    beforeCancellations,
    cancellations,
    adjustedOriginal,
  };
}

export function findMissingQuotedInvoiceLines(input: {
  quoteItems: AcceptedQuoteLine[];
  manifestItems: ManifestItemRecord[];
  invoiceItems: InvoiceItemRecord[];
}) {
  const manifestByQuoteItemId = buildManifestByQuoteItemId(input.manifestItems);
  const invoicedQuoteItemIds = new Set(
    input.invoiceItems
      .filter((line) => !line.deleted_at && line.quote_item_id)
      .map((line) => line.quote_item_id as string)
  );

  const missingQuoteItems = input.quoteItems.filter(
    (quoteItem) =>
      isActiveAcceptedQuoteLine(quoteItem, manifestByQuoteItemId) &&
      !invoicedQuoteItemIds.has(quoteItem.id)
  );

  return missingQuoteItems
    .map((quoteItem) => {
      const quotedLinks = (manifestByQuoteItemId.get(quoteItem.id) ?? []).filter(
        (item) => item.source_type === "quoted"
      );
      return quotedLinks.find((item) => shouldIncludeManifestItemInInvoice(item)) ?? null;
    })
    .filter((item): item is ManifestItemRecord => Boolean(item));
}

export type InvoiceCommercialSummary = {
  quoteAudit: QuoteTotalAudit;
  totalGroups: InvoiceTotalGroups;
};

export function buildInvoiceCommercialSummary(input: {
  quoteItems: AcceptedQuoteLine[];
  manifestItems: ManifestItemRecord[];
  invoiceItems: InvoiceItemRecord[];
  taxRatePercent: number;
}): InvoiceCommercialSummary {
  const manifestById = new Map(input.manifestItems.map((item) => [item.id, item]));

  return {
    quoteAudit: calculateQuoteTotalAudit({
      quoteItems: input.quoteItems,
      manifestItems: input.manifestItems,
      taxRatePercent: input.taxRatePercent,
    }),
    totalGroups: calculateInvoiceTotalGroups(input.invoiceItems, manifestById),
  };
}
