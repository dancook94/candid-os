import type { ManifestItemRecord } from "@/lib/manifest/types";
import { NON_INVOICE_BILLING_STATUSES } from "@/lib/invoice/constants";
import type { InvoiceDraftRecord, InvoiceItemRecord } from "@/lib/invoice/types";
import {
  findMissingQuotedInvoiceLines,
  isOriginalQuoteInvoiceLine,
} from "@/lib/invoice/total-groups";
import {
  calculateInvoiceDraftTotals,
  calculateInvoiceLineTotals,
  draftTotalsMatchItems,
  invoiceLineNeedsPricing,
  normalizeInvoiceItemNumericFields,
  parseMoneyValue,
  parseQuantityValue,
} from "@/lib/invoice/money";

export type ApprovalChecklistItem = {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
};

export type InvoiceApprovalReadiness = {
  canApprove: boolean;
  checklist: ApprovalChecklistItem[];
  blockingReasons: string[];
  lineIssues: Array<{ itemId: string; itemName: string; reasons: string[] }>;
};

export function getBillableInvoiceLines(items: InvoiceItemRecord[]) {
  return items.filter(
    (item) =>
      !item.deleted_at &&
      !NON_INVOICE_BILLING_STATUSES.includes(
        item.billing_status as (typeof NON_INVOICE_BILLING_STATUSES)[number]
      )
  );
}

function validateBillableLine(line: InvoiceItemRecord): string[] {
  const normalized = normalizeInvoiceItemNumericFields(line);
  const issues: string[] = [];

  if (!normalized.item_name?.trim()) {
    issues.push("Item title is required.");
  }

  if (!normalized.description?.trim() && !normalized.item_name?.trim()) {
    issues.push("Description or item title is required.");
  }

  if (!(normalized.quantity > 0)) {
    issues.push("Quantity must be greater than zero.");
  }

  if (normalized.unit_price === null) {
    issues.push("Unit price is missing.");
  } else if (normalized.unit_price < 0) {
    issues.push("Unit price cannot be negative.");
  }

  if (normalized.tax_rate < 0) {
    issues.push("VAT rate is missing or invalid.");
  }

  if (invoiceLineNeedsPricing(normalized)) {
    issues.push("Billing status is still price required.");
  }

  const expectedNet = calculateInvoiceLineTotals({
    quantity: normalized.quantity,
    unitPrice: normalized.unit_price,
    taxRate: normalized.tax_rate,
  }).netTotal;

  if (
    normalized.unit_price !== null &&
    !invoiceLineNeedsPricing(normalized) &&
    Math.abs(normalized.line_total - expectedNet) > 0.01
  ) {
    issues.push("Line total does not match quantity and unit price.");
  }

  return issues;
}

export function buildInvoiceApprovalReadiness(input: {
  draft: InvoiceDraftRecord;
  invoiceItems: InvoiceItemRecord[];
  manifestItems?: ManifestItemRecord[];
  companyName: string | null;
  quoteLinked: boolean;
}): InvoiceApprovalReadiness {
  const billableLines = getBillableInvoiceLines(input.invoiceItems);
  const lineIssues = billableLines
    .map((line) => ({
      itemId: line.id,
      itemName: line.item_name,
      reasons: validateBillableLine(line),
    }))
    .filter((entry) => entry.reasons.length > 0);

  const unpricedLines = billableLines.filter(invoiceLineNeedsPricing);
  const normalizedDraft = {
    ...input.draft,
    subtotal: parseMoneyValue(input.draft.subtotal) ?? 0,
    tax_total: parseMoneyValue(input.draft.tax_total) ?? 0,
    total: parseMoneyValue(input.draft.total) ?? 0,
  };
  const calculatedTotals = calculateInvoiceDraftTotals(input.invoiceItems);
  const totalsMatch = draftTotalsMatchItems(input.draft, input.invoiceItems);

  const missingQuotedLines = input.manifestItems
    ? findMissingQuotedInvoiceLines({
        manifestItems: input.manifestItems,
        invoiceItems: input.invoiceItems,
      })
    : [];

  const manifestById = new Map(
    (input.manifestItems ?? []).map((item) => [item.id, item])
  );
  const originalInvoiceLines = billableLines.filter((line) => {
    const manifestItem = line.production_item_id
      ? manifestById.get(line.production_item_id) ?? null
      : null;
    return isOriginalQuoteInvoiceLine(line, manifestItem);
  });

  const checklist: ApprovalChecklistItem[] = [
    {
      id: "original_quote_lines",
      label: "Active accepted quote lines included",
      passed: missingQuotedLines.length === 0,
      detail:
        missingQuotedLines.length > 0
          ? `${missingQuotedLines.length} quote line(s) missing from the invoice draft.`
          : originalInvoiceLines.length > 0
            ? `${originalInvoiceLines.length} original quote line(s) on invoice`
            : input.manifestItems?.some((item) => item.source_type === "quoted")
              ? "No active quoted items remain billable."
              : "No quoted items on this job.",
    },
    {
      id: "customer",
      label: "Customer confirmed",
      passed: Boolean(input.draft.company_id && input.companyName?.trim()),
      detail: input.companyName?.trim()
        ? input.companyName
        : "Company mapping is missing.",
    },
    {
      id: "quote",
      label: "Accepted quote linked",
      passed: input.quoteLinked,
      detail: input.quoteLinked ? undefined : "No accepted quote is linked to this job.",
    },
    {
      id: "po",
      label: "PO/reference confirmed",
      passed: true,
      detail: input.draft.purchase_order_number?.trim()
        ? `PO ${input.draft.purchase_order_number.trim()}`
        : "Optional — no PO recorded yet.",
    },
    {
      id: "lines",
      label: "Invoice contains billable lines",
      passed: billableLines.length > 0,
      detail:
        billableLines.length > 0
          ? `${billableLines.length} billable line(s)`
          : "Add at least one billable invoice line.",
    },
    {
      id: "pricing",
      label: "All billable items priced",
      passed: unpricedLines.length === 0 && lineIssues.length === 0,
      detail:
        unpricedLines.length > 0
          ? `${unpricedLines.length} line(s) still need pricing.`
          : lineIssues.length > 0
            ? `${lineIssues.length} line(s) have validation issues.`
            : undefined,
    },
    {
      id: "vat",
      label: "VAT set on all billable lines",
      passed: billableLines.every(
        (line) => line.tax_rate !== null && line.tax_rate !== undefined && line.tax_rate >= 0
      ),
    },
    {
      id: "currency",
      label: "Currency present",
      passed: Boolean(input.draft.currency?.trim()),
    },
    {
      id: "totals",
      label: "Totals calculate successfully",
      passed:
        totalsMatch &&
        unpricedLines.length === 0 &&
        normalizedDraft.subtotal >= 0 &&
        normalizedDraft.tax_total >= 0 &&
        normalizedDraft.total >= 0,
      detail: !totalsMatch
        ? `Saved draft total ${normalizedDraft.total.toFixed(2)} does not match calculated total ${calculatedTotals.total.toFixed(2)}.`
        : unpricedLines.length > 0
          ? "Totals will update once all billable lines are priced."
          : calculatedTotals.total > 0
            ? `Subtotal ${calculatedTotals.subtotal.toFixed(2)}, VAT ${calculatedTotals.tax_total.toFixed(2)}, total ${calculatedTotals.total.toFixed(2)}.`
            : undefined,
    },
  ];

  const blockingReasons: string[] = [];

  if (input.draft.status === "approved") {
    blockingReasons.push("This invoice draft is already approved.");
  } else if (input.draft.status === "pushed_to_xero") {
    blockingReasons.push("This invoice draft has already been pushed to Xero.");
  } else if (input.draft.status === "invoiced") {
    blockingReasons.push("This invoice draft is already invoiced.");
  } else if (input.draft.status === "cancelled") {
    blockingReasons.push("This invoice draft is cancelled.");
  }

  if (billableLines.length === 0) {
    blockingReasons.push("The invoice draft has no billable lines.");
  }

  if (unpricedLines.length > 0) {
    blockingReasons.push(
      `${unpricedLines.length} billable line(s) still require pricing before approval.`
    );
  }

  for (const issue of lineIssues) {
    blockingReasons.push(
      `${issue.itemName}: ${issue.reasons.join(" ")}`
    );
  }

  if (missingQuotedLines.length > 0) {
    blockingReasons.push(
      `${missingQuotedLines.length} active accepted quote line(s) are missing from the invoice draft.`
    );
  }

  if (!input.draft.company_id || !input.companyName?.trim()) {
    blockingReasons.push("Company/customer mapping is missing.");
  }

  if (!input.draft.currency?.trim()) {
    blockingReasons.push("Invoice currency is missing.");
  }

  const canApprove =
    blockingReasons.length === 0 &&
    checklist.filter((item) => item.id !== "po").every((item) => item.passed);

  return {
    canApprove,
    checklist,
    blockingReasons: [...new Set(blockingReasons)],
    lineIssues,
  };
}
