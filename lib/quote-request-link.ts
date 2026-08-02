import type { SupabaseClient } from "@supabase/supabase-js";

import { formatOpportunityStageLabel } from "@/lib/crm/opportunity-stages";
import { normalizeSupabaseQueryError } from "@/lib/customer-settings/query-errors";

export type LinkedOpportunitySummary = {
  id: string;
  title: string;
  stage: string;
  stageLabel: string;
};

export type LinkedQuoteSummary = {
  id: string;
  quoteNumber: number;
  status: string;
  currentVersion: number;
  total: number | null;
  sentAt: string | null;
  hasCurrentVersion: boolean;
};

export type QuoteRequestContext = {
  id: string;
  opportunityId: string | null;
};

export type QuoteRequestQuoteDisplayState =
  | {
      kind: "awaiting";
      label: "Awaiting review";
      adminLabel: "Awaiting review";
      customerLabel: "Awaiting review";
    }
  | {
      kind: "opportunity_no_quote";
      label: "Quote not started";
      adminLabel: "Quote not started";
      customerLabel: "Preparing quote";
      opportunity: LinkedOpportunitySummary;
    }
  | {
      kind: "in_progress";
      label: "Quote in progress";
      adminLabel: "Quote in progress";
      customerLabel: "Preparing quote";
      quote: LinkedQuoteSummary;
      opportunity: LinkedOpportunitySummary | null;
    }
  | {
      kind: "sent";
      label: "Quote sent";
      adminLabel: "Quote sent";
      customerLabel: "Quote received";
      quote: LinkedQuoteSummary;
      opportunity: LinkedOpportunitySummary | null;
    }
  | {
      kind: "accepted";
      label: "Accepted";
      adminLabel: "Accepted";
      customerLabel: "Accepted";
      quote: LinkedQuoteSummary;
      opportunity: LinkedOpportunitySummary | null;
    }
  | {
      kind: "declined";
      label: "Declined";
      adminLabel: "Declined";
      customerLabel: "Declined";
      quote: LinkedQuoteSummary;
      opportunity: LinkedOpportunitySummary | null;
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
      opportunity: LinkedOpportunitySummary | null;
    };

type QuoteRowForLink = {
  id: string;
  quote_request_id: string | null;
  opportunity_id: string | null;
  quote_number: number;
  status: string;
  current_version: number;
  updated_at?: string | null;
};

type VersionRowForLink = {
  version_number: number;
  version_status: string;
  total: number | null;
  sent_at: string | null;
};

const QUOTE_STATUS_PRIORITY: Record<string, number> = {
  accepted: 100,
  sent: 80,
  draft: 60,
  declined: 40,
  expired: 30,
  superseded: 20,
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

export function selectPrimaryQuoteForRequest(
  quotes: QuoteRowForLink[]
): QuoteRowForLink | null {
  if (quotes.length === 0) {
    return null;
  }

  if (quotes.length === 1) {
    return quotes[0] ?? null;
  }

  return [...quotes].sort((left, right) => {
    const priorityDiff =
      (QUOTE_STATUS_PRIORITY[right.status.toLowerCase()] ?? 0) -
      (QUOTE_STATUS_PRIORITY[left.status.toLowerCase()] ?? 0);

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const leftUpdated = left.updated_at ? Date.parse(left.updated_at) : 0;
    const rightUpdated = right.updated_at ? Date.parse(right.updated_at) : 0;

    return rightUpdated - leftUpdated;
  })[0] ?? null;
}

export function buildQuoteRequestDisplayState(input: {
  linkedQuote: LinkedQuoteSummary | null;
  linkedOpportunity: LinkedOpportunitySummary | null;
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

  if (!input.linkedOpportunity && !input.linkedQuote) {
    return {
      kind: "awaiting",
      label: "Awaiting review",
      adminLabel: "Awaiting review",
      customerLabel: "Awaiting review",
    };
  }

  if (input.linkedOpportunity && !input.linkedQuote) {
    return {
      kind: "opportunity_no_quote",
      label: "Quote not started",
      adminLabel: "Quote not started",
      customerLabel: "Preparing quote",
      opportunity: input.linkedOpportunity,
    };
  }

  if (!input.linkedQuote) {
    return {
      kind: "awaiting",
      label: "Awaiting review",
      adminLabel: "Awaiting review",
      customerLabel: "Awaiting review",
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
      opportunity: input.linkedOpportunity,
    };
  }

  const kind = mapQuoteStatusToDisplayKind(input.linkedQuote.status);
  const opportunity = input.linkedOpportunity;

  if (kind === "in_progress") {
    return {
      kind: "in_progress",
      label: "Quote in progress",
      adminLabel: "Quote in progress",
      customerLabel: "Preparing quote",
      quote: input.linkedQuote,
      opportunity,
    };
  }

  if (kind === "accepted") {
    return {
      kind: "accepted",
      label: "Accepted",
      adminLabel: "Accepted",
      customerLabel: "Accepted",
      quote: input.linkedQuote,
      opportunity,
    };
  }

  if (kind === "declined") {
    return {
      kind: "declined",
      label: "Declined",
      adminLabel: "Declined",
      customerLabel: "Declined",
      quote: input.linkedQuote,
      opportunity,
    };
  }

  return {
    kind: "sent",
    label: "Quote sent",
    adminLabel: "Quote sent",
    customerLabel: "Quote received",
    quote: input.linkedQuote,
    opportunity,
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

function mapOpportunityRow(row: {
  id: string;
  title: string;
  stage: string;
}): LinkedOpportunitySummary {
  return {
    id: row.id,
    title: row.title,
    stage: row.stage,
    stageLabel: formatOpportunityStageLabel(row.stage),
  };
}

export async function loadLinkedOpportunity(
  supabase: SupabaseClient,
  opportunityId: string | null
): Promise<{
  opportunity: LinkedOpportunitySummary | null;
  loadError: string | null;
}> {
  if (!opportunityId) {
    return { opportunity: null, loadError: null };
  }

  const { data, error } = await supabase
    .from("opportunities")
    .select("id, title, stage")
    .eq("id", opportunityId)
    .maybeSingle();

  if (error) {
    const normalized = normalizeSupabaseQueryError(error);

    if (process.env.NODE_ENV === "development") {
      console.error("[quote-request-link] linked opportunity query failed", {
        opportunityId,
        code: normalized.code ?? null,
        message: normalized.message ?? String(error),
      });
    }

    return {
      opportunity: null,
      loadError: normalized.message ?? "Linked opportunity could not be loaded.",
    };
  }

  return {
    opportunity: data ? mapOpportunityRow(data) : null,
    loadError: null,
  };
}

async function loadQuotesForRequestContext(
  supabase: SupabaseClient,
  context: QuoteRequestContext
): Promise<QuoteRowForLink[]> {
  const filters: string[] = [];

  if (context.opportunityId) {
    filters.push(`opportunity_id.eq.${context.opportunityId}`);
  }

  filters.push(`quote_request_id.eq.${context.id}`);

  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, quote_request_id, opportunity_id, quote_number, status, current_version, updated_at"
    )
    .or(filters.join(","))
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  const uniqueQuotes = new Map<string, QuoteRowForLink>();

  for (const quote of data ?? []) {
    uniqueQuotes.set(quote.id, quote);
  }

  return [...uniqueQuotes.values()];
}

export async function loadLinkedQuoteForRequest(
  supabase: SupabaseClient,
  context: QuoteRequestContext | string
): Promise<{
  quote: LinkedQuoteSummary | null;
  opportunity: LinkedOpportunitySummary | null;
  loadError: string | null;
}> {
  const requestContext: QuoteRequestContext =
    typeof context === "string"
      ? { id: context, opportunityId: null }
      : context;

  if (
    typeof context === "string" &&
    !requestContext.opportunityId
  ) {
    const { data: requestRow, error: requestError } = await supabase
      .from("quote_requests")
      .select("id, opportunity_id")
      .eq("id", requestContext.id)
      .maybeSingle();

    if (requestError) {
      const normalized = normalizeSupabaseQueryError(requestError);
      return {
        quote: null,
        opportunity: null,
        loadError: normalized.message ?? "Quote request could not be loaded.",
      };
    }

    requestContext.opportunityId = requestRow?.opportunity_id ?? null;
  }

  const [opportunityLoad, quoteRowsResult] = await Promise.all([
    loadLinkedOpportunity(supabase, requestContext.opportunityId),
    loadQuotesForRequestContext(supabase, requestContext).catch((error) => ({
      error,
      quotes: [] as QuoteRowForLink[],
    })),
  ]);

  if ("error" in quoteRowsResult && quoteRowsResult.error) {
    const normalized = normalizeSupabaseQueryError(quoteRowsResult.error);

    if (process.env.NODE_ENV === "development") {
      console.error("[quote-request-link] linked quote query failed", {
        quoteRequestId: requestContext.id,
        opportunityId: requestContext.opportunityId,
        code: normalized.code ?? null,
        message: normalized.message ?? String(quoteRowsResult.error),
      });
    }

    return {
      quote: null,
      opportunity: opportunityLoad.opportunity,
      loadError:
        opportunityLoad.loadError ??
        normalized.message ??
        "Linked quote could not be loaded.",
    };
  }

  const quoteRows =
    "error" in quoteRowsResult ? [] : quoteRowsResult;
  const primaryQuote = selectPrimaryQuoteForRequest(quoteRows);

  if (!primaryQuote) {
    return {
      quote: null,
      opportunity: opportunityLoad.opportunity,
      loadError: opportunityLoad.loadError,
    };
  }

  try {
    return {
      quote: await loadLinkedQuoteSummary(supabase, primaryQuote),
      opportunity: opportunityLoad.opportunity,
      loadError: opportunityLoad.loadError,
    };
  } catch (loadError) {
    return {
      quote: null,
      opportunity: opportunityLoad.opportunity,
      loadError:
        loadError instanceof Error
          ? loadError.message
          : "Linked quote version could not be loaded.",
    };
  }
}

export async function loadLinkedQuotesByRequestIds(
  supabase: SupabaseClient,
  requests: QuoteRequestContext[]
): Promise<{
  quotesByRequestId: Map<string, LinkedQuoteSummary>;
  opportunitiesByRequestId: Map<string, LinkedOpportunitySummary>;
  loadError: string | null;
}> {
  const quotesByRequestId = new Map<string, LinkedQuoteSummary>();
  const opportunitiesByRequestId = new Map<string, LinkedOpportunitySummary>();

  if (requests.length === 0) {
    return { quotesByRequestId, opportunitiesByRequestId, loadError: null };
  }

  const requestIds = requests.map((request) => request.id);
  const opportunityIds = [
    ...new Set(
      requests
        .map((request) => request.opportunityId)
        .filter((value): value is string => Boolean(value))
    ),
  ];

  const filters = [`quote_request_id.in.(${requestIds.join(",")})`];

  if (opportunityIds.length > 0) {
    filters.push(`opportunity_id.in.(${opportunityIds.join(",")})`);
  }

  const [{ data: linkedQuotes, error }, { data: opportunities, error: oppError }] =
    await Promise.all([
      supabase
        .from("quotes")
        .select(
          "id, quote_request_id, opportunity_id, quote_number, status, current_version, updated_at"
        )
        .or(filters.join(","))
        .order("updated_at", { ascending: false }),
      opportunityIds.length > 0
        ? supabase
            .from("opportunities")
            .select("id, title, stage")
            .in("id", opportunityIds)
        : Promise.resolve({ data: [] as { id: string; title: string; stage: string }[], error: null }),
    ]);

  if (error) {
    const normalized = normalizeSupabaseQueryError(error);

    if (process.env.NODE_ENV === "development") {
      console.error("[quote-request-link] batch linked quote query failed", {
        requestIds,
        code: normalized.code ?? null,
        message: normalized.message ?? String(error),
      });
    }

    return {
      quotesByRequestId,
      opportunitiesByRequestId,
      loadError: normalized.message ?? "Linked quotes could not be loaded.",
    };
  }

  if (oppError) {
    const normalized = normalizeSupabaseQueryError(oppError);

    if (process.env.NODE_ENV === "development") {
      console.error("[quote-request-link] batch opportunity query failed", {
        opportunityIds,
        code: normalized.code ?? null,
        message: normalized.message ?? String(oppError),
      });
    }
  }

  const opportunityById = new Map(
    (opportunities ?? []).map((row) => [row.id, mapOpportunityRow(row)])
  );

  for (const request of requests) {
    if (request.opportunityId) {
      const opportunity = opportunityById.get(request.opportunityId);

      if (opportunity) {
        opportunitiesByRequestId.set(request.id, opportunity);
      }
    }

    const candidateQuotes = (linkedQuotes ?? []).filter(
      (quote) =>
        quote.quote_request_id === request.id ||
        (request.opportunityId &&
          quote.opportunity_id === request.opportunityId)
    );

    const primaryQuote = selectPrimaryQuoteForRequest(candidateQuotes);

    if (!primaryQuote) {
      continue;
    }

    try {
      quotesByRequestId.set(
        request.id,
        await loadLinkedQuoteSummary(supabase, primaryQuote)
      );
    } catch (loadError) {
      if (process.env.NODE_ENV === "development") {
        console.error("[quote-request-link] linked quote version load failed", {
          quoteRequestId: request.id,
          quoteId: primaryQuote.id,
          message:
            loadError instanceof Error ? loadError.message : String(loadError),
        });
      }
    }
  }

  return { quotesByRequestId, opportunitiesByRequestId, loadError: null };
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

  return candidateRequests[0]!.id;
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

export async function resolveQuoteRequestIdFromQuote(
  supabase: SupabaseClient,
  quoteId: string
): Promise<string | null> {
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("quote_request_id, opportunity_id, company_id")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError || !quote) {
    return null;
  }

  if (quote.quote_request_id) {
    return quote.quote_request_id;
  }

  if (!quote.opportunity_id) {
    return null;
  }

  return resolveQuoteRequestIdForQuote(supabase, {
    quoteRequestId: null,
    opportunityId: quote.opportunity_id,
    companyId: quote.company_id,
  });
}

export type CustomerCompanyQuoteRow = {
  id: string;
  quoteNumber: number;
  projectName: string;
  status: string;
  updatedAt: string;
};

const CUSTOMER_VISIBLE_QUOTE_STATUSES = [
  "sent",
  "accepted",
  "declined",
  "expired",
  "superseded",
] as const;

export async function loadCustomerCompanyQuotes(
  supabase: SupabaseClient,
  { limit = 20 }: { limit?: number } = {}
): Promise<{
  quotes: CustomerCompanyQuoteRow[];
  loadError: string | null;
}> {
  const { data, error } = await supabase
    .from("quotes")
    .select("id, quote_number, project_name, status, updated_at")
    .in("status", [...CUSTOMER_VISIBLE_QUOTE_STATUSES])
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    const normalized = normalizeSupabaseQueryError(error);

    if (process.env.NODE_ENV === "development") {
      console.error("[quote-request-link] customer company quotes failed", {
        code: normalized.code ?? null,
        message: normalized.message ?? String(error),
      });
    }

    return {
      quotes: [],
      loadError: normalized.message ?? "Company quotes could not be loaded.",
    };
  }

  return {
    quotes: (data ?? []).map((quote) => ({
      id: quote.id,
      quoteNumber: quote.quote_number,
      projectName: quote.project_name,
      status: quote.status,
      updatedAt: quote.updated_at,
    })),
    loadError: null,
  };
}
