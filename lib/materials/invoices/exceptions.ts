import type { InvoiceListItem } from "@/lib/materials/invoices/queries";

export const EXCEPTION_KINDS = [
  "supplier",
  "new_material",
  "uncertain_match",
  "price_change",
  "extraction",
  "ready",
] as const;

export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export const EXCEPTION_LABELS: Record<ExceptionKind | "attention", string> = {
  attention: "Needs a person",
  supplier: "Supplier not recognised",
  new_material: "New material to approve",
  uncertain_match: "Uncertain match",
  price_change: "Price change to approve",
  extraction: "Could not read the invoice",
  ready: "Matched, ready to check",
};

const PRIORITY: ExceptionKind[] = [
  "extraction",
  "supplier",
  "price_change",
  "new_material",
  "uncertain_match",
  "ready",
];

export function invoiceExceptionKinds(invoice: InvoiceListItem): ExceptionKind[] {
  const counts = invoice.lineCounts;
  const lineTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const kinds: ExceptionKind[] = [];
  const extractionProblem =
    invoice.extractionStatus !== "extracted" || lineTotal === 0 || counts.extraction_error > 0;

  if (extractionProblem) {
    kinds.push("extraction");
  }

  if (!invoice.supplierName) {
    kinds.push("supplier");
  }

  if (counts.price_change > 0) {
    kinds.push("price_change");
  }

  if (counts.unmatched > 0) {
    kinds.push("new_material");
  }

  if (counts.needs_review > 0 || counts.query > 0) {
    kinds.push("uncertain_match");
  }

  if (
    !extractionProblem &&
    invoice.supplierName &&
    counts.price_change === 0 &&
    counts.unmatched === 0 &&
    counts.needs_review === 0 &&
    counts.query === 0 &&
    lineTotal > 0 &&
    counts.processed + counts.ignored === lineTotal
  ) {
    kinds.push("ready");
  }

  return PRIORITY.filter((kind) => kinds.includes(kind));
}

export function filterInvoiceExceptions(
  invoices: readonly InvoiceListItem[],
  query: { kind?: string | null; supplier?: string | null; from?: string | null; to?: string | null }
) {
  const kind = query.kind && query.kind !== "all" ? query.kind : "attention";

  return invoices.filter((invoice) => {
    const kinds = invoiceExceptionKinds(invoice);

    if (kind === "attention" && (kinds.length === 0 || kinds.every((item) => item === "ready"))) {
      return false;
    }

    if (kind !== "attention" && !kinds.includes(kind as ExceptionKind)) {
      return false;
    }

    if (query.supplier && invoice.supplierName !== query.supplier) {
      return false;
    }

    if (query.from && (invoice.invoiceDate ?? "") < query.from) {
      return false;
    }

    if (query.to && (invoice.invoiceDate ?? "9999-99-99") > query.to) {
      return false;
    }

    return true;
  });
}
