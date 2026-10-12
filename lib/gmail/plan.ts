import type { GmailDocumentType } from "@/lib/gmail/classify";
import { classifyPdfText } from "@/lib/gmail/classify";
import { GMAIL_MAX_FILE_BYTES } from "@/lib/gmail/config";

export type PdfDiscoveryPlan = {
  documentType: Exclude<GmailDocumentType, "unsupported_image">;
  status: "stored" | "duplicate" | "failed";
  storeFile: boolean;
  duplicateInvoiceId: string | null;
  duplicateItemId: string | null;
  detail: string | null;
};

export function planPdfDiscovery(input: {
  text: string | null;
  extractFailed: boolean;
  byteSize: number;
  manualInvoiceId: string | null;
  existingDiscoveryItemId: string | null;
}): PdfDiscoveryPlan {
  if (input.byteSize > GMAIL_MAX_FILE_BYTES) {
    return {
      documentType: "unknown",
      status: "failed",
      storeFile: false,
      duplicateInvoiceId: null,
      duplicateItemId: null,
      detail: "The attachment is larger than 15 MB.",
    };
  }

  if (input.manualInvoiceId) {
    return {
      documentType: input.text ? classifyPdfText(input.text) : "unknown",
      status: "duplicate",
      storeFile: false,
      duplicateInvoiceId: input.manualInvoiceId,
      duplicateItemId: null,
      detail: "This file matches a supplier invoice that was already uploaded.",
    };
  }

  if (input.existingDiscoveryItemId) {
    return {
      documentType: input.text ? classifyPdfText(input.text) : "unknown",
      status: "duplicate",
      storeFile: false,
      duplicateInvoiceId: null,
      duplicateItemId: input.existingDiscoveryItemId,
      detail: "This file was already saved during discovery.",
    };
  }

  if (input.extractFailed || !input.text?.trim()) {
    return {
      documentType: "unknown",
      status: "failed",
      storeFile: true,
      duplicateInvoiceId: null,
      duplicateItemId: null,
      detail: input.extractFailed
        ? "The PDF could not be read."
        : "The PDF has no text layer. OCR is not connected.",
    };
  }

  const documentType = classifyPdfText(input.text);
  const detail =
    documentType === "credit_note"
      ? "Credit note kept for later. It was not created as a supplier invoice."
      : documentType === "unknown"
        ? "The document type was not recognised."
        : null;

  return {
    documentType,
    status: "stored",
    storeFile: true,
    duplicateInvoiceId: null,
    duplicateItemId: null,
    detail,
  };
}

export function planOtherAttachment(kind: "image" | "other", byteSize: number) {
  if (byteSize > GMAIL_MAX_FILE_BYTES) {
    return {
      documentType: kind === "image" ? ("unsupported_image" as const) : ("unknown" as const),
      status: "failed" as const,
      detail: "The attachment is larger than 15 MB.",
    };
  }

  if (kind === "image") {
    return {
      documentType: "unsupported_image" as const,
      status: "recorded" as const,
      detail: "Image attachment recorded for future OCR. The image was not read.",
    };
  }

  return {
    documentType: "unknown" as const,
    status: "skipped" as const,
    detail: "This file type is not a PDF or a supported image.",
  };
}
