import type { SupabaseClient } from "@supabase/supabase-js";

export type QuoteResponseAction = "accept" | "decline";

type QuoteResponseContext = {
  quote: {
    id: string;
    status: string;
    current_version: number;
  };
  version: {
    id: string;
    version_number: number;
    version_status: string;
  };
};

export type QuoteStatusResponseResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

function responseError(
  status: number,
  message: string
): QuoteStatusResponseResult {
  return { ok: false, status, message };
}

export function isQuoteAwaitingDecision({
  quoteStatus,
  versionStatus,
  versionNumber,
  currentVersion,
}: {
  quoteStatus: string;
  versionStatus: string;
  versionNumber: number;
  currentVersion: number;
}) {
  if (versionNumber !== currentVersion) {
    return false;
  }

  if (
    quoteStatus === "draft" ||
    versionStatus === "draft" ||
    quoteStatus === "expired" ||
    versionStatus === "expired" ||
    versionStatus === "superseded"
  ) {
    return false;
  }

  return quoteStatus === "sent" && versionStatus === "sent";
}

export function quoteResponseConflictMessage(
  quoteStatus: string,
  versionStatus: string
): string {
  if (quoteStatus === "accepted" || versionStatus === "accepted") {
    return "This quote has already been accepted.";
  }

  if (quoteStatus === "declined" || versionStatus === "declined") {
    return "This quote has already been declined.";
  }

  if (
    quoteStatus === "expired" ||
    versionStatus === "expired" ||
    versionStatus === "superseded"
  ) {
    return "This quote version can no longer be accepted or declined.";
  }

  return "This quote is no longer awaiting a decision.";
}

export async function applyQuoteStatusResponse(
  supabase: SupabaseClient,
  context: QuoteResponseContext,
  action: QuoteResponseAction
): Promise<QuoteStatusResponseResult> {
  const now = new Date().toISOString();
  const nextQuoteStatus = action === "accept" ? "accepted" : "declined";
  const nextVersionStatus = action === "accept" ? "accepted" : "declined";

  const { data: updatedQuote, error: quoteUpdateError } = await supabase
    .from("quotes")
    .update({
      status: nextQuoteStatus,
      updated_at: now,
    })
    .eq("id", context.quote.id)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();

  if (quoteUpdateError) {
    return responseError(500, quoteUpdateError.message);
  }

  if (!updatedQuote) {
    return responseError(409, "This quote has already been actioned.");
  }

  const versionUpdate =
    action === "accept"
      ? {
          version_status: "accepted" as const,
          accepted_at: now,
          declined_at: null,
        }
      : {
          version_status: "declined" as const,
          declined_at: now,
          accepted_at: null,
        };

  const { data: updatedVersion, error: versionUpdateError } = await supabase
    .from("quote_versions")
    .update(versionUpdate)
    .eq("id", context.version.id)
    .eq("version_status", "sent")
    .select("id")
    .maybeSingle();

  if (versionUpdateError || !updatedVersion) {
    await supabase
      .from("quotes")
      .update({
        status: "sent",
        updated_at: now,
      })
      .eq("id", context.quote.id)
      .eq("status", nextQuoteStatus);

    return responseError(
      500,
      versionUpdateError?.message ??
        "Unable to update the quote version. No changes were saved."
    );
  }

  return { ok: true };
}
