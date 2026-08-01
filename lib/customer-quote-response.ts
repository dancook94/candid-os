import type { SupabaseClient } from "@supabase/supabase-js";

type QuoteResponseAction = "accept" | "decline";

type LoadedQuoteContext = {
  quote: {
    id: string;
    company_id: string;
    status: string;
    current_version: number;
  };
  version: {
    id: string;
    version_number: number;
    version_status: string;
  };
};

export type CustomerQuoteResponseResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

function responseError(status: number, message: string): CustomerQuoteResponseResult {
  return { ok: false, status, message };
}

async function loadQuoteContext(
  supabase: SupabaseClient,
  userId: string,
  quoteId: string
): Promise<CustomerQuoteResponseResult | LoadedQuoteContext> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("account_status, company_id")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    return responseError(403, "Unable to verify your account.");
  }

  if (profile.account_status !== "approved") {
    return responseError(
      403,
      "Your account must be approved before you can respond to quotations."
    );
  }

  if (!profile.company_id) {
    return responseError(403, "Your account is not linked to a company.");
  }

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, company_id, status, current_version")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    return responseError(500, quoteError.message);
  }

  if (!quote) {
    return responseError(404, "Quote not found.");
  }

  if (quote.company_id !== profile.company_id) {
    return responseError(403, "You do not have permission to respond to this quote.");
  }

  const { data: version, error: versionError } = await supabase
    .from("quote_versions")
    .select("id, version_number, version_status")
    .eq("quote_id", quote.id)
    .eq("version_number", quote.current_version)
    .maybeSingle();

  if (versionError) {
    return responseError(500, versionError.message);
  }

  if (!version) {
    return responseError(409, "This quote version is no longer available.");
  }

  if (quote.status !== "sent" || version.version_status !== "sent") {
    if (quote.status === "accepted" || version.version_status === "accepted") {
      return responseError(409, "This quote has already been accepted.");
    }

    if (quote.status === "declined" || version.version_status === "declined") {
      return responseError(409, "This quote has already been declined.");
    }

    return responseError(
      409,
      "This quote is no longer awaiting a decision."
    );
  }

  if (version.version_number !== quote.current_version) {
    return responseError(409, "This quote version is no longer current.");
  }

  return { quote, version };
}

async function applyQuoteResponse(
  supabase: SupabaseClient,
  context: LoadedQuoteContext,
  action: QuoteResponseAction
): Promise<CustomerQuoteResponseResult> {
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

export async function respondToCustomerQuote(
  supabase: SupabaseClient,
  {
    userId,
    quoteId,
    action,
  }: {
    userId: string;
    quoteId: string;
    action: QuoteResponseAction;
  }
): Promise<CustomerQuoteResponseResult> {
  const loaded = await loadQuoteContext(supabase, userId, quoteId);

  if ("ok" in loaded) {
    return loaded;
  }

  return applyQuoteResponse(supabase, loaded, action);
}

export function canCustomerRespondToQuote({
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
  return (
    quoteStatus === "sent" &&
    versionStatus === "sent" &&
    versionNumber === currentVersion
  );
}
