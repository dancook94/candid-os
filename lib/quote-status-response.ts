import type { SupabaseClient } from "@supabase/supabase-js";

export type QuoteResponseAction = "accept" | "decline";

export type QuoteAcceptanceJobInfo = {
  jobId: string | null;
  jobReference: string | null;
  jobCreated: boolean;
  jobWarning: string | null;
  schemaMissing: boolean;
};

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
  | { ok: true; job?: QuoteAcceptanceJobInfo }
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

  if (
    quoteStatus === "accepted" ||
    versionStatus === "accepted" ||
    quoteStatus === "declined" ||
    versionStatus === "declined"
  ) {
    return false;
  }

  return quoteStatus === "sent" && versionStatus === "sent";
}

export type QuoteDecisionState =
  | {
      kind: "awaiting_decision";
      canRespond: true;
    }
  | {
      kind: "accepted";
      canRespond: false;
      decidedAt: string | null;
    }
  | {
      kind: "declined";
      canRespond: false;
      decidedAt: string | null;
    }
  | {
      kind: "expired";
      canRespond: false;
    }
  | {
      kind: "superseded";
      canRespond: false;
    }
  | {
      kind: "draft";
      canRespond: false;
    }
  | {
      kind: "unavailable";
      canRespond: false;
      reason: string;
    };

export function getQuoteDecisionState({
  quoteStatus,
  versionStatus,
  versionNumber,
  currentVersion,
  acceptedAt = null,
  declinedAt = null,
}: {
  quoteStatus: string;
  versionStatus: string;
  versionNumber: number;
  currentVersion: number;
  acceptedAt?: string | null;
  declinedAt?: string | null;
}): QuoteDecisionState {
  const normalizedQuoteStatus = quoteStatus.toLowerCase();
  const normalizedVersionStatus = versionStatus.toLowerCase();

  if (
    normalizedQuoteStatus === "accepted" ||
    normalizedVersionStatus === "accepted"
  ) {
    return {
      kind: "accepted",
      canRespond: false,
      decidedAt: acceptedAt,
    };
  }

  if (
    normalizedQuoteStatus === "declined" ||
    normalizedVersionStatus === "declined"
  ) {
    return {
      kind: "declined",
      canRespond: false,
      decidedAt: declinedAt,
    };
  }

  if (
    isQuoteAwaitingDecision({
      quoteStatus,
      versionStatus,
      versionNumber,
      currentVersion,
    })
  ) {
    return {
      kind: "awaiting_decision",
      canRespond: true,
    };
  }

  if (
    normalizedQuoteStatus === "expired" ||
    normalizedVersionStatus === "expired"
  ) {
    return { kind: "expired", canRespond: false };
  }

  if (normalizedVersionStatus === "superseded") {
    return { kind: "superseded", canRespond: false };
  }

  if (
    normalizedQuoteStatus === "draft" ||
    normalizedVersionStatus === "draft"
  ) {
    return { kind: "draft", canRespond: false };
  }

  return {
    kind: "unavailable",
    canRespond: false,
    reason: quoteResponseConflictMessage(quoteStatus, versionStatus),
  };
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
    const { data: currentQuote } = await supabase
      .from("quotes")
      .select("status")
      .eq("id", context.quote.id)
      .maybeSingle();

    const { data: currentVersion } = await supabase
      .from("quote_versions")
      .select("version_status")
      .eq("id", context.version.id)
      .maybeSingle();

    if (currentQuote && currentVersion) {
      return responseError(
        409,
        quoteResponseConflictMessage(
          currentQuote.status,
          currentVersion.version_status
        )
      );
    }

    return responseError(
      409,
      "This quote could not be updated. It may already have been actioned."
    );
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
