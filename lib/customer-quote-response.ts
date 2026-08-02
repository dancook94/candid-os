import type { SupabaseClient } from "@supabase/supabase-js";

import {
  applyQuoteStatusResponse,
  isQuoteAwaitingDecision,
  quoteResponseConflictMessage,
  type QuoteResponseAction,
  type QuoteStatusResponseResult,
} from "@/lib/quote-status-response";
import { syncOpportunityFromQuoteEvent } from "@/lib/crm/opportunity-stage-sync";

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

export type CustomerQuoteResponseResult = QuoteStatusResponseResult;

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

  if (
    !isQuoteAwaitingDecision({
      quoteStatus: quote.status,
      versionStatus: version.version_status,
      versionNumber: version.version_number,
      currentVersion: quote.current_version,
    })
  ) {
    return responseError(
      409,
      quoteResponseConflictMessage(quote.status, version.version_status)
    );
  }

  return { quote, version };
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

  const result = await applyQuoteStatusResponse(supabase, loaded, action);

  if (!result.ok) {
    return result;
  }

  await syncOpportunityFromQuoteEvent(supabase, {
    quoteId,
    event: action === "accept" ? "quote_accepted" : "quote_declined",
    changedBy: userId,
  });

  return result;
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
  return isQuoteAwaitingDecision({
    quoteStatus,
    versionStatus,
    versionNumber,
    currentVersion,
  });
}
