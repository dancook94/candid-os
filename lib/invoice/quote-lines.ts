import type { InvoiceItemRecord } from "@/lib/invoice/types";
import {
  calculateInvoiceLineTotals,
  normalizeInvoiceItemNumericFields,
  roundMoney,
} from "@/lib/invoice/money";
import type { ManifestItemRecord } from "@/lib/manifest/types";

export type AcceptedQuoteLine = {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  is_optional: boolean;
  sort_order: number;
};

export type QuoteLineSourceGroup =
  | "originally_quoted"
  | "production_changes"
  | "final_invoice"
  | "unknown";

export type QuoteLineDiagnostic = {
  quoteItemId: string;
  title: string;
  grossValue: number;
  matchedManifestItemId: string | null;
  requirementStatus: string | null;
  billingStatus: string | null;
  sourceGroup: QuoteLineSourceGroup;
  includedInOriginallyQuoted: boolean;
  includedInProductionChanges: boolean;
  includedInFinalInvoice: boolean;
  excludedReason: string | null;
};

export function resolveManifestSourceGroup(
  manifestItem: ManifestItemRecord | null
): QuoteLineSourceGroup {
  if (!manifestItem) {
    return "unknown";
  }

  if (isOriginallyQuotedManifestItem(manifestItem)) {
    return "originally_quoted";
  }

  return "production_changes";
}

export function formatSourceGroup(value?: QuoteLineSourceGroup | string | null) {
  if (!value) {
    return "Unknown";
  }

  return value.replaceAll("_", " ");
}

type LegacyQuoteLineDiagnostic = Partial<QuoteLineDiagnostic> & {
  quoteItemId?: string;
  title?: string;
  included?: boolean;
};

export function normalizeQuoteLineDiagnostic(
  diagnostic: LegacyQuoteLineDiagnostic
): QuoteLineDiagnostic {
  const includedInOriginallyQuoted = diagnostic.includedInOriginallyQuoted ?? false;
  const includedInProductionChanges = diagnostic.includedInProductionChanges ?? false;
  const includedInFinalInvoice = diagnostic.includedInFinalInvoice ?? false;
  const legacyIncluded = diagnostic.included;

  let sourceGroup = diagnostic.sourceGroup;
  if (!sourceGroup) {
    if (includedInOriginallyQuoted || legacyIncluded === true) {
      sourceGroup = "originally_quoted";
    } else if (includedInProductionChanges) {
      sourceGroup = "production_changes";
    } else if (includedInFinalInvoice) {
      sourceGroup = "final_invoice";
    } else if (legacyIncluded === false) {
      sourceGroup = "unknown";
    } else {
      sourceGroup = "unknown";
    }
  }

  return {
    quoteItemId: diagnostic.quoteItemId ?? "unknown-quote-item",
    title: diagnostic.title ?? "Unknown line",
    grossValue: diagnostic.grossValue ?? 0,
    matchedManifestItemId: diagnostic.matchedManifestItemId ?? null,
    requirementStatus: diagnostic.requirementStatus ?? null,
    billingStatus: diagnostic.billingStatus ?? null,
    sourceGroup,
    includedInOriginallyQuoted:
      includedInOriginallyQuoted || sourceGroup === "originally_quoted",
    includedInProductionChanges:
      includedInProductionChanges || sourceGroup === "production_changes",
    includedInFinalInvoice:
      includedInFinalInvoice || sourceGroup === "final_invoice",
    excludedReason: diagnostic.excludedReason ?? null,
  };
}

export function isOriginallyQuotedManifestItem(item: ManifestItemRecord) {
  return item.source_type === "quoted" || Boolean(item.quote_item_id);
}

export function isProductionChangeManifestItem(item: ManifestItemRecord) {
  return !isOriginallyQuotedManifestItem(item);
}

export function partitionManifestItemsForReview(manifestItems: ManifestItemRecord[]) {
  const originallyQuoted = manifestItems.filter(isOriginallyQuotedManifestItem);
  const productionChanges = manifestItems.filter(isProductionChangeManifestItem);

  return { originallyQuoted, productionChanges };
}

export function quoteVersionVatRateToPercent(vatRate: number | null | undefined) {
  if (vatRate === null || vatRate === undefined) {
    return 20;
  }

  return vatRate <= 1 ? roundMoney(vatRate * 100) : roundMoney(vatRate);
}

export function buildManifestByQuoteItemId(manifestItems: ManifestItemRecord[]) {
  const map = new Map<string, ManifestItemRecord[]>();

  for (const item of manifestItems) {
    if (!item.quote_item_id) {
      continue;
    }

    const bucket = map.get(item.quote_item_id) ?? [];
    bucket.push(item);
    map.set(item.quote_item_id, bucket);
  }

  return map;
}

export function getQuotedManifestLinksForQuoteItem(
  quoteItemId: string,
  manifestByQuoteItemId: Map<string, ManifestItemRecord[]>
) {
  return (manifestByQuoteItemId.get(quoteItemId) ?? []).filter(
    (item) => item.source_type === "quoted"
  );
}

export function isManifestQuoteItemCancelled(manifestItem: ManifestItemRecord) {
  return (
    manifestItem.production_requirement_status === "cancelled" ||
    manifestItem.billing_status === "cancelled"
  );
}

export function isQuoteItemCancelled(
  quoteItemId: string,
  manifestByQuoteItemId: Map<string, ManifestItemRecord[]>
) {
  const quotedLinks = getQuotedManifestLinksForQuoteItem(
    quoteItemId,
    manifestByQuoteItemId
  );

  if (quotedLinks.length === 0) {
    return false;
  }

  return quotedLinks.some(isManifestQuoteItemCancelled);
}

export function isActiveAcceptedQuoteLine(
  quoteItem: AcceptedQuoteLine,
  manifestByQuoteItemId: Map<string, ManifestItemRecord[]>
) {
  if (quoteItem.is_optional) {
    return false;
  }

  return !isQuoteItemCancelled(quoteItem.id, manifestByQuoteItemId);
}

export function acceptedQuoteLineToSyntheticInvoiceLine(
  quoteItem: AcceptedQuoteLine,
  taxRatePercent: number
): InvoiceItemRecord {
  const totals = calculateInvoiceLineTotals({
    quantity: quoteItem.quantity,
    unitPrice: quoteItem.unit_price,
    taxRate: taxRatePercent,
  });

  return normalizeInvoiceItemNumericFields({
    id: quoteItem.id,
    invoice_draft_id: "",
    job_id: "",
    production_item_id: null,
    quote_item_id: quoteItem.id,
    item_name: quoteItem.title,
    description: quoteItem.description,
    quantity: quoteItem.quantity,
    unit: "each",
    unit_price: quoteItem.unit_price,
    line_total: totals.netTotal,
    tax_rate: taxRatePercent,
    billing_status: "ready_to_invoice",
    pricing_source: "accepted_quote",
    pricing_note: null,
    manually_edited: false,
    created_at: "",
    updated_at: "",
    deleted_at: null,
  });
}

export function buildQuoteLineDiagnostics(input: {
  quoteItems: AcceptedQuoteLine[];
  manifestItems: ManifestItemRecord[];
  invoiceItems: InvoiceItemRecord[];
  taxRatePercent: number;
}): QuoteLineDiagnostic[] {
  const manifestByQuoteItemId = buildManifestByQuoteItemId(input.manifestItems);
  const invoicedQuoteItemIds = new Set(
    input.invoiceItems
      .filter((line) => !line.deleted_at && line.quote_item_id)
      .map((line) => line.quote_item_id as string)
  );

  return input.quoteItems
    .filter((item) => !item.is_optional)
    .map((quoteItem) => {
      const quotedLinks = getQuotedManifestLinksForQuoteItem(
        quoteItem.id,
        manifestByQuoteItemId
      );
      const matchedManifest =
        quotedLinks[0] ??
        (manifestByQuoteItemId.get(quoteItem.id) ?? [])[0] ??
        null;
      const cancelled = isQuoteItemCancelled(quoteItem.id, manifestByQuoteItemId);
      const grossValue = calculateInvoiceLineTotals({
        quantity: quoteItem.quantity,
        unitPrice: quoteItem.unit_price,
        taxRate: input.taxRatePercent,
      }).grossTotal;
      const sourceGroup = resolveManifestSourceGroup(matchedManifest);
      const includedInOriginallyQuoted = sourceGroup === "originally_quoted";
      const includedInProductionChanges = sourceGroup === "production_changes";
      const includedInFinalInvoice =
        !cancelled && invoicedQuoteItemIds.has(quoteItem.id);

      let excludedReason: string | null = null;
      if (cancelled) {
        excludedReason = "Cancelled quoted item excluded from final invoice.";
      } else if (!matchedManifest) {
        excludedReason = "No quoted manifest item linked yet.";
      } else if (!includedInFinalInvoice) {
        excludedReason = "Active quoted item not yet on final invoice draft.";
      }

      return normalizeQuoteLineDiagnostic({
        quoteItemId: quoteItem.id,
        title: quoteItem.title,
        grossValue,
        matchedManifestItemId: matchedManifest?.id ?? null,
        requirementStatus: matchedManifest?.production_requirement_status ?? null,
        billingStatus: matchedManifest?.billing_status ?? null,
        sourceGroup,
        includedInOriginallyQuoted,
        includedInProductionChanges,
        includedInFinalInvoice,
        excludedReason,
      });
    });
}

export function findMissingActiveQuoteLines(input: {
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

  return input.quoteItems.filter(
    (quoteItem) =>
      isActiveAcceptedQuoteLine(quoteItem, manifestByQuoteItemId) &&
      !invoicedQuoteItemIds.has(quoteItem.id)
  );
}
