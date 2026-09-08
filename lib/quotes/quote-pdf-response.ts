import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchCustomerFormalQuote,
  loadLinkedQuoteRequestDeadline,
} from "@/lib/customer-formal-quote-data";
import {
  buildCustomerQuotePdfFilename,
  isAdminQuotePdfDownloadable,
  isCustomerQuotePdfDownloadable,
} from "@/lib/customer-quote-request";

export { isAdminQuotePdfDownloadable } from "@/lib/customer-quote-request";

type CreateQuotePdfResponseInput = {
  supabase: SupabaseClient;
  quoteId: string;
  contactName: string;
  contactEmail: string | null;
  fallbackCompanyName: string;
  versionNumber?: number;
  allowDraftVersion?: boolean;
};

function logQuotePdfFailure(
  stage: "load" | "generate",
  input: CreateQuotePdfResponseInput,
  error: unknown
) {
  console.error("[quote-pdf] failed", {
    stage,
    quoteId: input.quoteId,
    versionNumber: input.versionNumber ?? null,
    allowDraftVersion: input.allowDraftVersion ?? false,
    message: error instanceof Error ? error.message : String(error),
    ...(process.env.NODE_ENV === "development" && error instanceof Error
      ? { stack: error.stack }
      : {}),
  });
}

export async function createQuotePdfResponse(input: CreateQuotePdfResponseInput) {
  let quote;

  try {
    quote = await fetchCustomerFormalQuote(input.supabase, input.quoteId, {
      customerContactName: input.contactName,
      customerEmail: input.contactEmail,
      fallbackCompanyName: input.fallbackCompanyName,
      versionNumber: input.versionNumber,
      allowDraftVersion: input.allowDraftVersion ?? false,
    });
  } catch (error) {
    logQuotePdfFailure("load", input, error);
    return Response.json({ error: "Unable to generate PDF." }, { status: 500 });
  }

  if (!quote) {
    return Response.json({ error: "Quote not found." }, { status: 404 });
  }

  const isDownloadable = input.allowDraftVersion
    ? isAdminQuotePdfDownloadable(quote.versionStatus)
    : isCustomerQuotePdfDownloadable(quote.versionStatus);

  if (!isDownloadable) {
    return Response.json(
      { error: "This quote version is not available for download." },
      { status: 403 }
    );
  }

  const { data: quoteLinkRow } = await input.supabase
    .from("quotes")
    .select("id, quote_request_id")
    .eq("id", input.quoteId)
    .maybeSingle();

  const deadlineLoad = await loadLinkedQuoteRequestDeadline(input.supabase, {
    quoteId: input.quoteId,
    quoteRequestId: quoteLinkRow?.quote_request_id ?? null,
  });

  if (deadlineLoad.loadError) {
    console.error(
      "[approved-deadline] pdf quote request query error:",
      deadlineLoad.loadError
    );
  }

  try {
    const { generateCustomerQuotePdf } = await import(
      "@/lib/generate-customer-quote-pdf"
    );

    const pdfBuffer = await generateCustomerQuotePdf({
      ...quote,
      approvedDeadline: deadlineLoad.approvedDeadline,
    });
    const filename = buildCustomerQuotePdfFilename(
      quote.quoteNumber,
      quote.versionNumber,
      quote.projectName
    );

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logQuotePdfFailure("generate", input, error);
    return Response.json({ error: "Unable to generate PDF." }, { status: 500 });
  }
}
