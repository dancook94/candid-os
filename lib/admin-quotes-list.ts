import type { SupabaseClient } from "@supabase/supabase-js";

export const ADMIN_QUOTE_STATUS_OPTIONS = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "superseded",
] as const;

export const ADMIN_QUOTE_SORT_OPTIONS = [
  "newest",
  "oldest",
  "highest",
  "lowest",
  "project_asc",
  "project_desc",
] as const;

export type AdminQuoteStatus = (typeof ADMIN_QUOTE_STATUS_OPTIONS)[number];
export type AdminQuoteSort = (typeof ADMIN_QUOTE_SORT_OPTIONS)[number];

export const ADMIN_QUOTE_OPPORTUNITY_LINK_OPTIONS = [
  "all",
  "linked",
  "not_linked",
] as const;

export type AdminQuoteOpportunityLink =
  (typeof ADMIN_QUOTE_OPPORTUNITY_LINK_OPTIONS)[number];

export type AdminQuotesListSearchParams = {
  search?: string;
  status?: string;
  company?: string;
  from?: string;
  to?: string;
  sort?: string;
  opportunity?: string;
};

export type AdminQuotesListFilters = {
  search: string;
  status: AdminQuoteStatus | null;
  companyId: string | null;
  fromDate: string | null;
  toDate: string | null;
  sort: AdminQuoteSort;
  opportunityLink: AdminQuoteOpportunityLink;
};

export type AdminQuoteListRow = {
  id: string;
  quote_number: number;
  company_id: string;
  quote_request_id: string | null;
  project_name: string;
  status: string;
  current_version: number;
  created_at: string;
  updated_at: string;
  company_name: string;
  customer_name: string | null;
  current_version_total: number;
  sent_at: string | null;
  opportunity_id: string | null;
  opportunity_title: string | null;
  opportunity_stage: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateParam(value: string | undefined) {
  if (!value || !DATE_PATTERN.test(value)) {
    return null;
  }

  return value;
}

function parseStatusParam(value: string | undefined): AdminQuoteStatus | null {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();

  if (
    (ADMIN_QUOTE_STATUS_OPTIONS as readonly string[]).includes(normalized)
  ) {
    return normalized as AdminQuoteStatus;
  }

  return null;
}

function parseSortParam(value: string | undefined): AdminQuoteSort {
  if (
    value &&
    (ADMIN_QUOTE_SORT_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as AdminQuoteSort;
  }

  return "newest";
}

function parseOpportunityLinkParam(
  value: string | undefined
): AdminQuoteOpportunityLink {
  if (
    value &&
    (ADMIN_QUOTE_OPPORTUNITY_LINK_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as AdminQuoteOpportunityLink;
  }

  return "all";
}

export function parseAdminQuotesListFilters(
  params: AdminQuotesListSearchParams
): AdminQuotesListFilters {
  return {
    search: params.search?.trim() ?? "",
    status: parseStatusParam(params.status),
    companyId: params.company?.trim() || null,
    fromDate: parseDateParam(params.from),
    toDate: parseDateParam(params.to),
    sort: parseSortParam(params.sort),
    opportunityLink: parseOpportunityLinkParam(params.opportunity),
  };
}

export function hasActiveAdminQuotesFilters(filters: AdminQuotesListFilters) {
  return Boolean(
    filters.search ||
      filters.status ||
      filters.companyId ||
      filters.fromDate ||
      filters.toDate ||
      filters.sort !== "newest" ||
      filters.opportunityLink !== "all"
  );
}

export function buildAdminQuotesListHref(
  filters: AdminQuotesListFilters,
  overrides: Partial<AdminQuotesListFilters> = {}
) {
  const nextFilters = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (nextFilters.search) {
    params.set("search", nextFilters.search);
  }

  if (nextFilters.status) {
    params.set("status", nextFilters.status);
  }

  if (nextFilters.companyId) {
    params.set("company", nextFilters.companyId);
  }

  if (nextFilters.fromDate) {
    params.set("from", nextFilters.fromDate);
  }

  if (nextFilters.toDate) {
    params.set("to", nextFilters.toDate);
  }

  if (nextFilters.sort !== "newest") {
    params.set("sort", nextFilters.sort);
  }

  if (nextFilters.opportunityLink !== "all") {
    params.set("opportunity", nextFilters.opportunityLink);
  }

  const query = params.toString();

  return query ? `/admin/quotes?${query}` : "/admin/quotes";
}

type QuoteRecord = {
  id: string;
  quote_number: number;
  company_id: string;
  quote_request_id: string | null;
  opportunity_id: string | null;
  project_name: string;
  status: string;
  current_version: number;
  created_at: string;
  updated_at: string;
};

type VersionRecord = {
  quote_id: string;
  version_number: number;
  total: number | string | null;
  created_at: string;
};

function startOfDayIso(date: string) {
  return `${date}T00:00:00.000Z`;
}

function endOfDayIso(date: string) {
  return `${date}T23:59:59.999Z`;
}

function sanitizeIlikeTerm(value: string) {
  return value.replace(/[%_,]/g, " ").trim();
}

function parseQuoteNumberSearchTerm(search: string) {
  const trimmed = search.trim();

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const prefixedMatch = trimmed.match(/^q-?(\d+)$/i);

  if (prefixedMatch) {
    return Number.parseInt(prefixedMatch[1], 10);
  }

  return null;
}

async function resolveSearchMatchingQuoteIds(
  supabase: SupabaseClient,
  search: string
) {
  const term = search.trim();

  if (!term) {
    return null;
  }

  const sanitizedTerm = sanitizeIlikeTerm(term);

  if (!sanitizedTerm) {
    return [];
  }

  const matchingIds = new Set<string>();
  const ilikePattern = `%${sanitizedTerm}%`;
  const quoteNumber = parseQuoteNumberSearchTerm(term);

  const { data: quotesByProject } = await supabase
    .from("quotes")
    .select("id")
    .ilike("project_name", ilikePattern);

  quotesByProject?.forEach((quote) => matchingIds.add(quote.id));

  if (quoteNumber !== null) {
    const { data: quotesByNumber } = await supabase
      .from("quotes")
      .select("id")
      .eq("quote_number", quoteNumber);

    quotesByNumber?.forEach((quote) => matchingIds.add(quote.id));
  }

  const { data: companies } = await supabase
    .from("companies")
    .select("id")
    .ilike("company_name", ilikePattern);

  const companyIds = (companies ?? []).map((company) => company.id);

  if (companyIds.length > 0) {
    const { data: quotesByCompany } = await supabase
      .from("quotes")
      .select("id")
      .in("company_id", companyIds);

    quotesByCompany?.forEach((quote) => matchingIds.add(quote.id));
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .ilike("full_name", ilikePattern);

  const profileIds = (profiles ?? []).map((profile) => profile.id);

  if (profileIds.length > 0) {
    const { data: quoteRequests } = await supabase
      .from("quote_requests")
      .select("id")
      .in("requested_by", profileIds);

    const requestIds = (quoteRequests ?? []).map((request) => request.id);

    if (requestIds.length > 0) {
      const { data: quotesByRequest } = await supabase
        .from("quotes")
        .select("id")
        .in("quote_request_id", requestIds);

      quotesByRequest?.forEach((quote) => matchingIds.add(quote.id));
    }
  }

  const { data: opportunitiesByTitle } = await supabase
    .from("opportunities")
    .select("id")
    .ilike("title", ilikePattern);

  const opportunityIds = (opportunitiesByTitle ?? []).map(
    (opportunity) => opportunity.id
  );

  if (opportunityIds.length > 0) {
    const { data: quotesByOpportunity } = await supabase
      .from("quotes")
      .select("id")
      .in("opportunity_id", opportunityIds);

    quotesByOpportunity?.forEach((quote) => matchingIds.add(quote.id));
  }

  return [...matchingIds];
}

function sortQuoteRows(rows: AdminQuoteListRow[], sort: AdminQuoteSort) {
  const sorted = [...rows];

  switch (sort) {
    case "oldest":
      sorted.sort(
        (left, right) =>
          new Date(left.created_at).getTime() -
          new Date(right.created_at).getTime()
      );
      break;
    case "highest":
      sorted.sort(
        (left, right) => right.current_version_total - left.current_version_total
      );
      break;
    case "lowest":
      sorted.sort(
        (left, right) => left.current_version_total - right.current_version_total
      );
      break;
    case "project_asc":
      sorted.sort((left, right) =>
        left.project_name.localeCompare(right.project_name, "en-GB", {
          sensitivity: "base",
        })
      );
      break;
    case "project_desc":
      sorted.sort((left, right) =>
        right.project_name.localeCompare(left.project_name, "en-GB", {
          sensitivity: "base",
        })
      );
      break;
    case "newest":
    default:
      sorted.sort(
        (left, right) =>
          new Date(right.created_at).getTime() -
          new Date(left.created_at).getTime()
      );
      break;
  }

  return sorted;
}

function resolveSentDate(status: string, version: VersionRecord | undefined) {
  if (
    !version ||
    !["sent", "accepted", "declined", "expired"].includes(status)
  ) {
    return null;
  }

  return version.created_at;
}

export async function fetchAdminQuotesList(
  supabase: SupabaseClient,
  filters: AdminQuotesListFilters
) {
  const searchMatchingIds = await resolveSearchMatchingQuoteIds(
    supabase,
    filters.search
  );

  if (searchMatchingIds && searchMatchingIds.length === 0) {
    const { count: totalQuoteCount, error: totalCountError } = await supabase
      .from("quotes")
      .select("*", { count: "exact", head: true });

    return {
      quotes: [] as AdminQuoteListRow[],
      totalQuoteCount: totalCountError ? 0 : (totalQuoteCount ?? 0),
      filteredTotalValue: 0,
      queryError: totalCountError?.message ?? null,
    };
  }

  let quotesQuery = supabase
    .from("quotes")
    .select(
      "id, quote_number, company_id, quote_request_id, opportunity_id, project_name, status, current_version, created_at, updated_at"
    );

  if (searchMatchingIds) {
    quotesQuery = quotesQuery.in("id", searchMatchingIds);
  }

  if (filters.opportunityLink === "linked") {
    quotesQuery = quotesQuery.not("opportunity_id", "is", null);
  } else if (filters.opportunityLink === "not_linked") {
    quotesQuery = quotesQuery.is("opportunity_id", null);
  }

  if (filters.status) {
    quotesQuery = quotesQuery.eq("status", filters.status);
  }

  if (filters.companyId) {
    quotesQuery = quotesQuery.eq("company_id", filters.companyId);
  }

  if (filters.fromDate) {
    quotesQuery = quotesQuery.gte("created_at", startOfDayIso(filters.fromDate));
  }

  if (filters.toDate) {
    quotesQuery = quotesQuery.lte("created_at", endOfDayIso(filters.toDate));
  }

  if (filters.sort === "project_asc") {
    quotesQuery = quotesQuery.order("project_name", { ascending: true });
  } else if (filters.sort === "project_desc") {
    quotesQuery = quotesQuery.order("project_name", { ascending: false });
  } else if (filters.sort === "oldest") {
    quotesQuery = quotesQuery.order("created_at", { ascending: true });
  } else {
    quotesQuery = quotesQuery.order("created_at", { ascending: false });
  }

  const [{ count: totalQuoteCount, error: totalCountError }, { data, error }] =
    await Promise.all([
      supabase.from("quotes").select("*", { count: "exact", head: true }),
      quotesQuery,
    ]);

  const quotes = (data ?? []) as QuoteRecord[];
  const queryError = error?.message ?? totalCountError?.message ?? null;

  if (quotes.length === 0) {
    return {
      quotes: [] as AdminQuoteListRow[],
      totalQuoteCount: totalCountError ? 0 : (totalQuoteCount ?? 0),
      filteredTotalValue: 0,
      queryError,
    };
  }

  const quoteIds = quotes.map((quote) => quote.id);
  const companyIds = [...new Set(quotes.map((quote) => quote.company_id))];
  const requestIds = [
    ...new Set(
      quotes
        .map((quote) => quote.quote_request_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const opportunityIds = [
    ...new Set(
      quotes
        .map((quote) => quote.opportunity_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const [
    { data: versions, error: versionsError },
    { data: companies, error: companiesError },
    { data: quoteRequests, error: quoteRequestsError },
    { data: opportunities, error: opportunitiesError },
  ] = await Promise.all([
    supabase
      .from("quote_versions")
      .select("quote_id, version_number, total, created_at")
      .in("quote_id", quoteIds),
    supabase
      .from("companies")
      .select("id, company_name")
      .in("id", companyIds),
    requestIds.length > 0
      ? supabase
          .from("quote_requests")
          .select("id, requested_by")
          .in("id", requestIds)
      : Promise.resolve({
          data: [] as { id: string; requested_by: string }[],
          error: null,
        }),
    opportunityIds.length > 0
      ? supabase
          .from("opportunities")
          .select("id, title, stage")
          .in("id", opportunityIds)
      : Promise.resolve({
          data: [] as { id: string; title: string; stage: string }[],
          error: null,
        }),
  ]);

  const relatedErrors = [
    versionsError?.message,
    companiesError?.message,
    quoteRequestsError?.message,
    opportunitiesError?.message,
  ].filter(Boolean);

  const requesterIds = [
    ...new Set((quoteRequests ?? []).map((request) => request.requested_by)),
  ];

  const { data: requesters, error: requestersError } =
    requesterIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", requesterIds)
      : { data: [] as { id: string; full_name: string | null }[], error: null };

  if (requestersError?.message) {
    relatedErrors.push(requestersError.message);
  }

  const versionsByQuoteId = new Map<string, VersionRecord[]>();

  for (const version of versions ?? []) {
    const existing = versionsByQuoteId.get(version.quote_id) ?? [];
    existing.push(version as VersionRecord);
    versionsByQuoteId.set(version.quote_id, existing);
  }

  const companyNameById = new Map(
    (companies ?? []).map((company) => [company.id, company.company_name])
  );

  const requesterByRequestId = new Map(
    (quoteRequests ?? []).map((request) => [request.id, request.requested_by])
  );

  const requesterNameById = new Map(
    (requesters ?? []).map((requester) => [
      requester.id,
      requester.full_name || null,
    ])
  );

  const opportunityById = new Map(
    (opportunities ?? []).map((opportunity) => [
      opportunity.id,
      { title: opportunity.title, stage: opportunity.stage },
    ])
  );

  const rows: AdminQuoteListRow[] = quotes.map((quote) => {
    const quoteVersions = versionsByQuoteId.get(quote.id) ?? [];
    const currentVersion = quoteVersions.find(
      (version) => version.version_number === quote.current_version
    );

    const requesterId = quote.quote_request_id
      ? requesterByRequestId.get(quote.quote_request_id)
      : null;
    const linkedOpportunity = quote.opportunity_id
      ? opportunityById.get(quote.opportunity_id)
      : null;

    return {
      ...quote,
      company_name: companyNameById.get(quote.company_id) ?? "Unknown company",
      customer_name: requesterId
        ? (requesterNameById.get(requesterId) ?? null)
        : null,
      current_version_total: Number(currentVersion?.total ?? 0),
      sent_at: resolveSentDate(quote.status, currentVersion),
      opportunity_id: quote.opportunity_id,
      opportunity_title: linkedOpportunity?.title ?? null,
      opportunity_stage: linkedOpportunity?.stage ?? null,
    };
  });

  const sortedRows = sortQuoteRows(rows, filters.sort);
  const filteredTotalValue = sortedRows.reduce(
    (sum, quote) => sum + quote.current_version_total,
    0
  );

  return {
    quotes: sortedRows,
    totalQuoteCount: totalCountError ? 0 : (totalQuoteCount ?? 0),
    filteredTotalValue,
    queryError:
      queryError ?? (relatedErrors.length > 0 ? relatedErrors.join(" | ") : null),
  };
}
