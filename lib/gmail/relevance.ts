export const DOCUMENT_RELEVANCE = ["supplier_invoice", "needs_review", "irrelevant"] as const;

export type DocumentRelevance = (typeof DOCUMENT_RELEVANCE)[number];

export type DocumentQueue = "automatic" | "manual" | "excluded";

export const EXCLUDED_DETAIL_PREFIX = "Excluded as irrelevant";

export const MANUAL_DETAIL_PREFIX = "Needs manual classification";

export const NOT_SUPPLIER_INVOICE_DETAIL =
  "Marked as not a supplier invoice. The original PDF and checksum are unchanged.";

const TOP_CHARS = 1200;

export type DocumentRelevanceResult = {
  relevance: DocumentRelevance;
  reason: string;
};

function normalised(text: string) {
  return text.slice(0, TOP_CHARS).toLowerCase().replace(/\s+/g, " ");
}

function irrelevantReason(top: string) {
  if (
    /\b(?:overdue\s+payment\s+reminder|payment\s+reminder|overdue\s+reminder|reminder\s+of\s+(?:an\s+)?overdue(?:\s+payment)?)\b/.test(
      top
    )
  ) {
    return `${EXCLUDED_DETAIL_PREFIX}: overdue-payment reminder.`;
  }

  if (
    /\b(?:statement\s+of\s+account|account\s+statement|supplier\s+statement|statement\s+page|statement\s+date)\b/.test(
      top
    )
  ) {
    return `${EXCLUDED_DETAIL_PREFIX}: supplier statement.`;
  }

  if (/\bremittance advice\b/.test(top)) {
    return `${EXCLUDED_DETAIL_PREFIX}: remittance advice.`;
  }

  if (/\b(?:payment receipt|official receipt)\b/.test(top)) {
    return `${EXCLUDED_DETAIL_PREFIX}: receipt.`;
  }

  if (/\bcredit[\s-]control\b|\b(?:final\s+demand|letter\s+before\s+action|dunning(?:\s+letter)?)\b/.test(top)) {
    return `${EXCLUDED_DETAIL_PREFIX}: credit-control letter.`;
  }

  return null;
}

export function classifyDocumentRelevance(text: string): DocumentRelevanceResult {
  const top = normalised(text);
  const strongInvoice = /\b(?:sales|tax)\s+invoice\b/.test(top);
  const numberedInvoice = /\binvoice\s*(?:no\b|number\b|#)|\binvoice\s*:\s*\d/.test(top);
  const irrelevant = irrelevantReason(top);

  if (strongInvoice) {
    return {
      relevance: "supplier_invoice",
      reason: "Eligible for automatic processing when the supplier is approved.",
    };
  }

  if (irrelevant) {
    return { relevance: "irrelevant", reason: irrelevant };
  }

  if (numberedInvoice) {
    return {
      relevance: "supplier_invoice",
      reason: "Eligible for automatic processing when the supplier is approved.",
    };
  }

  if (/\binvoice\b/.test(top) || /\bpro[\s-]?forma\b/.test(top)) {
    return {
      relevance: "needs_review",
      reason: `${MANUAL_DETAIL_PREFIX}. The document mentions an invoice but is not clearly a supplier invoice.`,
    };
  }

  return {
    relevance: "needs_review",
    reason: `${MANUAL_DETAIL_PREFIX}. The document type is not clear enough for automatic processing.`,
  };
}

export function storedDocumentRelevance(input: {
  promotionRelevance?: string | null;
  detail?: string | null;
}): DocumentRelevance | null {
  if (
    input.promotionRelevance === "supplier_invoice" ||
    input.promotionRelevance === "needs_review" ||
    input.promotionRelevance === "irrelevant"
  ) {
    return input.promotionRelevance;
  }

  const detail = input.detail ?? "";

  if (detail.startsWith(EXCLUDED_DETAIL_PREFIX) || detail.startsWith("Marked as not a supplier invoice")) {
    return "irrelevant";
  }

  if (detail.startsWith(MANUAL_DETAIL_PREFIX)) {
    return "needs_review";
  }

  return null;
}

export function promotionQueue(input: {
  supplierMatched: boolean;
  supplierApproved: boolean;
  relevance: DocumentRelevance | null;
  status: string;
  documentType: string;
}): { queue: DocumentQueue; reason: string; selectable: boolean } {
  if (input.relevance === "irrelevant" || input.status === "skipped") {
    return {
      queue: "excluded",
      reason:
        input.relevance === "irrelevant"
          ? `${EXCLUDED_DETAIL_PREFIX}.`
          : `${EXCLUDED_DETAIL_PREFIX}. This stored document was skipped.`,
      selectable: false,
    };
  }

  if (input.relevance === "needs_review") {
    return {
      queue: "manual",
      reason: `${MANUAL_DETAIL_PREFIX}. The document is not clearly a supplier invoice.`,
      selectable: false,
    };
  }

  if (!input.supplierMatched) {
    return {
      queue: "manual",
      reason: `${MANUAL_DETAIL_PREFIX}. The supplier is not matched.`,
      selectable: false,
    };
  }

  if (!input.supplierApproved) {
    return {
      queue: "manual",
      reason: `${MANUAL_DETAIL_PREFIX}. This supplier is not approved for automatic processing.`,
      selectable: false,
    };
  }

  return {
    queue: "automatic",
    reason: "Eligible for automatic processing.",
    selectable: input.status === "stored" && input.documentType === "invoice",
  };
}
