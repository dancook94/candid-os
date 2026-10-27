import { NOT_SUPPLIER_INVOICE_DETAIL } from "@/lib/gmail/relevance";

export type DocumentExclusionPlan = {
  invoice: { id: string; processing_status: "ignored" };
  gmail: {
    id: string;
    status: "skipped";
    detail: string;
    promotion_relevance: "irrelevant";
  } | null;
  deletesInvoice: false;
  writes: readonly ("supplier_invoices" | "gmail_import_items")[];
};

export function documentExclusionPlan(invoice: {
  id: string;
  gmailImportItemId: string | null;
}): DocumentExclusionPlan {
  const gmail = invoice.gmailImportItemId
    ? {
        id: invoice.gmailImportItemId,
        status: "skipped" as const,
        detail: NOT_SUPPLIER_INVOICE_DETAIL,
        promotion_relevance: "irrelevant" as const,
      }
    : null;

  return {
    invoice: { id: invoice.id, processing_status: "ignored" },
    gmail,
    deletesInvoice: false,
    writes: gmail ? ["supplier_invoices", "gmail_import_items"] : ["supplier_invoices"],
  };
}

export function exclusionReprocessBlock(input: {
  processingStatus: string | null;
  gmailStatus: string | null;
  gmailDetail: string | null;
}) {
  if (
    input.processingStatus === "ignored" &&
    input.gmailStatus === "skipped" &&
    (input.gmailDetail ?? "").startsWith("Marked as not a supplier invoice")
  ) {
    return "This document was marked as not a supplier invoice. Reprocessing was stopped.";
  }

  return null;
}

export async function applyDocumentExclusion(
  port: {
    loadInvoice(invoiceId: string): Promise<{ id: string; gmailImportItemId: string | null } | null>;
    updateInvoice(update: DocumentExclusionPlan["invoice"]): Promise<void>;
    updateGmailItem(update: NonNullable<DocumentExclusionPlan["gmail"]>): Promise<void>;
  },
  invoiceId: string
) {
  const invoice = await port.loadInvoice(invoiceId);

  if (!invoice) {
    return { ok: false as const, status: 404, error: "Invoice not found." };
  }

  const plan = documentExclusionPlan(invoice);
  await port.updateInvoice(plan.invoice);

  if (plan.gmail) {
    await port.updateGmailItem(plan.gmail);
  }

  return { ok: true as const, plan };
}
