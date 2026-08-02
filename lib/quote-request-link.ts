import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeSupabaseQueryError } from "@/lib/customer-settings/query-errors";

export type LinkedQuoteSummary = {
  id: string;
  quoteNumber: number;
  status: string;
  currentVersion: number;
  total: number | null;
  sentAt: string | null;
  hasCurrentVersion: boolean;
};

export type QuoteRequestQuoteDisplayState =
  | {
      kind: "awaiting";
      label: "Awaiting quote";
      adminLabel: "Awaiting quote";
      customerLabel: "No quote yet";
    }
  | {
      kind: "in_progress";
      label: "Quote in progress";
      adminLabel: "Quote in progress";
      customerLabel: "Preparing quote";
      quote: LinkedQuoteSummary;
    }
  | {
      kind: "sent";
      label: "Quote sent";
      adminLabel: "Quote sent";
      customerLabel: "Quote received";
      quote: LinkedQuoteSummary;
    }
  | {
      kind: "accepted";
      label: "Accepted";
      adminLabel: "Accepted";
      customerLabel: "Accepted";
      quote: LinkedQuoteSummary;
    }
  | {
      kind: "declined";
      label: "Declined";
      adminLabel: "Declined";
      customerLabel: "Declined";
      quote: LinkedQuoteSummary;
    }
  | {
      kind: "load_error";
      label: "Quote link unavailable";
      adminLabel: "Quote link unavailable";
      customerLabel: "Quote status unavailable";
      message: string;
    }
  | {
      kind: "integrity_error";
      label: "Quote data issue";
      adminLabel: "Quote data issue";
      customerLabel: "Quote data issue";
      message: string;
      quote: LinkedQuoteSummary;
    };

type QuoteRowForLink = {
  id: string;
  quote_request_id: string | null;
  quote_number: number;
  status: string;
  current_version: number;
};

type VersionRowForLink = {
  version_number: number;
  version_status: string;
  total: number | null;
  sent_at: string | null;
};

function mapQuoteStatusToDisplayKind(
  status: string
): "in_progress" | "sent" | "accepted" | "declined" {
  switch (status.toLowerCase()) {
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "sent":
    case "expired":
    case "superseded":
      return "sent";
    default:
      return "in_progress";
  }
}

export function buildQuoteRequestDisplayState(input: {
  linkedQuote: LinkedQuoteSummary | null;
  loadError?: string | null;
}): QuoteRequestQuoteDisplayState {
  if (input.loadError) {
    return {
      kind: "load_error",
      label: "Quote link unavailable",
      adminLabel: "Quote link unavailable",
      customerLabel: "Quote status unavailable",
      message: input.loadError,
    };
  }

  if (!input.linkedQuote) {
    return {
      kind: "awaiting",
      label: "Awaiting quote",
      adminLabel: "Awaiting quote",
      customerLabel: "No quote yet",
    };
  }

  if (!input.linkedQuote.hasCurrentVersion) {
    return {
      kind: "integrity_error",
      label: "Quote data issue",
      adminLabel: "Quote data issue",
      customerLabel: "Quote data issue",
      message: "Linked quote is missing its current version.",
      quote: input.linkedQuote,
    };
  }

  const kind = mapQuoteStatusToDisplayKind(input.linkedQuote.status);

  if (kind === "in_progress") {
    return {
      kind: "in_progress",
      label: "Quote in progress",
      adminLabel: "Quote in progress",
      customerLabel: "Preparing quote",
      quote: input.linkedQuote,
    };
  }

  if (kind === "accepted") {
    return {
      kind: "accepted",
      label: "Accepted",
      adminLabel: "Accepted",
      customerLabel: "Accepted",
      quote: input.linkedQuote,
    };
  }

  if (kind === "declined") {
    return {
      kind: "declined",
      label: "Declined",
      adminLabel: "Declined",
      customerLabel: "Declined",
      quote: input.linkedQuote,
    };
  }

  return {
    kind: "sent",
    label: "Quote sent",
    adminLabel: "Quote sent",
    customerLabel: "Quote received",
    quote: input.linkedQuote,
  };
}

async function loadCurrentVersionForQuote(
  supabase: SupabaseClient,
  quote: Pick<QuoteRowForLink, "id" | "current_version">
): Promise<VersionRowForLink | null> {
  const { data, error } = await supabase
    .from("quote_versions")
    .select("version_number, version_status, total, sent_at, created_at")
    .eq("quote_id", quote.id)
    .eq("version_number", quote.current_version)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return {
    version_number: data.version_number,
    version_status: data.version_status,
    total: data.total,
    sent_at:
      data.sent_at ??
      (["sent", "accepted", "declined", "expired"].includes(
        data.version_status.toLowerCase()
      )
        ? data.created_at
        : null),
  };
}

export async function loadLinkedQuoteSummary(
  supabase: SupabaseClient,
  quote: QuoteRowForLink
): Promise<LinkedQuoteSummary> {
  let currentVersion: VersionRowForLink | null = null;

  try {
    currentVersion = await loadCurrentVersionForQuote(supabase, quote);
  } catch (error) {
    const normalized = normalizeSupabaseQueryError(error);
    throw new Error(normalized.message ?? "Unable to load linked quote version.");
  }

  return {
    id: quote.id,
    quoteNumber: quote.quote_number,
    status: quote.status,
    currentVersion: quote.current_version,
    total: currentVersion?.total ?? null,
    sentAt: currentVersion?.sent_at ?? null,
    hasCurrentVersion: Boolean(currentVersion),
  };
}

export async function loadLinkedQuoteForRequest(
  supabase: SupabaseClient,
  quoteRequestId: string
): Promise<{
  quote: LinkedQuoteSummary | null;
  loadError: string | null;
}> {
  const { data: linkedQuote, error } = await supabase
    .from("quotes")
    .select("id, quote_request_id, quote_number, status, current_version")
    .eq("quote_request_id", quoteRequestId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    const normalized = normalizeSupabaseQueryError(error);

    if (process.env.NODE_ENV === "development") {
      console.error("[quote-request-link] linked quote query failed", {
        quoteRequestId,
        code: normalized.code ?? null,
        message: normalized.message ?? String(error),
      });
    }

    return {
      quote: null,
      loadError: normalized.message ?? "Linked quote could not be loaded.",
    };
  }

  if (!linkedQuote) {
    return { quote: null, loadError: null };
  }

  try {
    return {
      quote: await loadLinkedQuoteSummary(supabase, linkedQuote),
      loadError: null,
    };
  } catch (loadError) {
    return {
      quote: null,
      loadError:
        loadError instanceof Error
          ? loadError.message
          : "Linked quote version could not be loaded.",
    };
  }
}

export async function loadLinkedQuotesByRequestIds(
  supabase: SupabaseClient,
  quoteRequestIds: string[]
): Promise<{
  quotesByRequestId: Map<string, LinkedQuoteSummary>;
  loadError: string | null;
}> {
  const quotesByRequestId = new Map<string, LinkedQuoteSummary>();

  if (quoteRequestIds.length === 0) {
    return { quotesByRequestId, loadError: null };
  }

  const { data: linkedQuotes, error } = await supabase
    .from("quotes")
    .select("id, quote_request_id, quote_number, status, current_version, updated_at")
    .in("quote_request_id", quoteRequestIds)
    .order("updated_at", { ascending: false });

  if (error) {
    const normalized = normalizeSupabaseQueryError(error);

    if (process.env.NODE_ENV === "development") {
      console.error("[quote-request-link] batch linked quote query failed", {
        quoteRequestIds,
        code: normalized.code ?? null,
        message: normalized.message ?? String(error),
      });
    }

    return {
      quotesByRequestId,
      loadError: normalized.message ?? "Linked quotes could not be loaded.",
    };
  }

  const latestQuoteByRequestId = new Map<string, QuoteRowForLink>();

  for (const quote of linkedQuotes ?? []) {
    if (
      quote.quote_request_id &&
      !latestQuoteByRequestId.has(quote.quote_request_id)
    ) {
      latestQuoteByRequestId.set(quote.quote_request_id, quote);
    }
  }

  for (const [requestId, quote] of latestQuoteByRequestId) {
    try {
      quotesByRequestId.set(
        requestId,
        await loadLinkedQuoteSummary(supabase, quote)
      );
    } catch (loadError) {
      if (process.env.NODE_ENV === "development") {
        console.error("[quote-request-link] linked quote version load failed", {
          quoteRequestId: requestId,
          quoteId: quote.id,
          message:
            loadError instanceof Error ? loadError.message : String(loadError),
        });
      }
    }
  }

  return { quotesByRequestId, loadError: null };
}

export async function resolveQuoteRequestIdForQuote(
  supabase: SupabaseClient,
  {
    quoteRequestId,
    opportunityId,
    companyId,
    excludeQuoteId,
  }: {
    quoteRequestId: string | null;
    opportunityId: string | null;
    companyId: string;
    excludeQuoteId?: string;
  }
): Promise<string | null> {
  if (quoteRequestId) {
    const { data: linkedRequest, error } = await supabase
      .from("quote_requests")
      .select("id, company_id")
      .eq("id", quoteRequestId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!linkedRequest || linkedRequest.company_id !== companyId) {
      throw new Error("Linked quote request must belong to the same company.");
    }

    return linkedRequest.id;
  }

  if (!opportunityId) {
    return null;
  }

  const { data: candidateRequests, error: candidateError } = await supabase
    .from("quote_requests")
    .select("id, company_id")
    .eq("opportunity_id", opportunityId)
    .eq("company_id", companyId);

  if (candidateError) {
    throw new Error(candidateError.message);
  }

  if (!candidateRequests || candidateRequests.length !== 1) {
    return null;
  }

  const candidateRequestId = candidateRequests[0]!.id;

  let existingQuoteQuery = supabase
    .from("quotes")
    .select("id")
    .eq("quote_request_id", candidateRequestId);

  if (excludeQuoteId) {
    existingQuoteQuery = existingQuoteQuery.neq("id", excludeQuoteId);
  }

  const { data: existingLinkedQuote, error: existingQuoteError } =
    await existingQuoteQuery.maybeSingle();

  if (existingQuoteError) {
    throw new Error(existingQuoteError.message);
  }

  if (existingLinkedQuote) {
    return null;
  }

  return candidateRequestId;
}

export async function syncQuoteRequestStatusFromQuote(
  supabase: SupabaseClient,
  {
    quoteRequestId,
    quoteStatus,
  }: {
    quoteRequestId: string;
    quoteStatus: string;
  }
) {
  const nextRequestStatus =
    quoteStatus === "draft"
      ? "reviewing"
      : quoteStatus === "sent" ||
          quoteStatus === "accepted" ||
          quoteStatus === "declined" ||
          quoteStatus === "expired" ||
          quoteStatus === "superseded"
        ? "quoted"
        : null;

  if (!nextRequestStatus) {
    return;
  }

  const { error } = await supabase
    .from("quote_requests")
    .update({ request_status: nextRequestStatus })
    .eq("id", quoteRequestId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function findQuoteRequestIdForOpportunity(
  supabase: SupabaseClient,
  {
    opportunityId,
    companyId,
  }: {
    opportunityId: string;
    companyId: string;
  }
): Promise<string | null> {
  return resolveQuoteRequestIdForQuote(supabase, {
    quoteRequestId: null,
    opportunityId,
    companyId,
  });
}
