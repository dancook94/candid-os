import { classifyDocumentRelevance } from "@/lib/gmail/relevance";

export const GMAIL_DOCUMENT_TYPES = [
  "invoice",
  "credit_note",
  "sales_order",
  "delivery_note",
  "unknown",
  "unsupported_image",
] as const;

export type GmailDocumentType = (typeof GMAIL_DOCUMENT_TYPES)[number];

const TOP_CHARS = 1200;

function earliest(text: string, patterns: RegExp[]) {
  let index: number | null = null;

  for (const pattern of patterns) {
    const match = pattern.exec(text);

    if (match && (index == null || match.index < index)) {
      index = match.index;
    }
  }

  return index;
}

export function classifyPdfText(text: string): Exclude<GmailDocumentType, "unsupported_image"> {
  const top = text.slice(0, TOP_CHARS).toLowerCase().replace(/\s+/g, " ");

  if (/\bcredit\s+note\b/.test(top)) {
    return "credit_note";
  }

  if (/\b(?:delivery|despatch|dispatch)\s+note\b/.test(top)) {
    return "delivery_note";
  }

  if (/\bpro[\s-]?forma\s+invoice\b/.test(top)) {
    return "unknown";
  }

  const relevance = classifyDocumentRelevance(text);

  if (relevance.relevance === "irrelevant") {
    return "unknown";
  }

  const invoiceAt = earliest(top, [
    /\bsales\s+invoice\b/,
    /\btax\s+invoice\b/,
    /\binvoice\s+no\b/,
    /\binvoice\s+number\b/,
    /\binvoice\s*:\s*\d/,
  ]);
  const orderAt = earliest(top, [
    /\bsales\s+order\b/,
    /\border\s+confirmation\b/,
    /\border\s+acknowledgement\b/,
    /\border\s+acknowledgment\b/,
  ]);

  if (
    invoiceAt != null &&
    (orderAt == null || invoiceAt <= orderAt) &&
    relevance.relevance === "supplier_invoice"
  ) {
    return "invoice";
  }

  if (orderAt != null) {
    return "sales_order";
  }

  return "unknown";
}
