import {
  NON_INVOICE_BILLING_STATUSES,
  UNPRICED_BILLING_STATUSES,
} from "@/lib/invoice/constants";
import type { InvoiceDraftRecord, InvoiceItemRecord } from "@/lib/invoice/types";

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
  const issues: string[] = [];

  if (!line.item_name?.trim()) {
    issues.push("Item title is required.");
  }

  if (!line.description?.trim() && !line.item_name?.trim()) {
    issues.push("Description or item title is required.");
  }

  if (!(line.quantity > 0)) {
    issues.push("Quantity must be greater than zero.");
  }

  if (line.unit_price === null || line.unit_price === undefined) {
    issues.push("Unit price is missing.");
  } else if (line.unit_price < 0) {
    issues.push("Unit price cannot be negative.");
  }

  if (line.tax_rate === null || line.tax_rate === undefined || line.tax_rate < 0) {
    issues.push("VAT rate is missing or invalid.");
  }

  if (
    UNPRICED_BILLING_STATUSES.includes(
      line.billing_status as (typeof UNPRICED_BILLING_STATUSES)[number]
    )
  ) {
    issues.push("Billing status is still price required.");
  }

  return issues;
}

export function buildInvoiceApprovalReadiness(input: {
  draft: InvoiceDraftRecord;
  invoiceItems: InvoiceItemRecord[];
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

  const unpricedLines = billableLines.filter(
    (line) =>
      line.unit_price === null ||
      UNPRICED_BILLING_STATUSES.includes(
        line.billing_status as (typeof UNPRICED_BILLING_STATUSES)[number]
      )
  );

  const checklist: ApprovalChecklistItem[] = [
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
        input.draft.subtotal >= 0 &&
        input.draft.tax_total >= 0 &&
        input.draft.total >= 0 &&
        Math.abs(
          input.draft.total - (input.draft.subtotal + input.draft.tax_total)
        ) < 0.02,
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
