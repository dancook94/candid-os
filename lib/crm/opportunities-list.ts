import type { SupabaseClient } from "@supabase/supabase-js";

import {
  OPPORTUNITY_STAGES,
  type OpportunityStage,
} from "@/lib/crm/types";
import { isOpportunityStage } from "@/lib/crm/opportunity-stages";

export const OPPORTUNITY_LIST_SORT_OPTIONS = [
  "newest",
  "oldest",
  "highest_value",
  "lowest_value",
  "follow_up_soonest",
  "recently_updated",
] as const;

export const OPPORTUNITY_LIST_SCOPE_OPTIONS = [
  "all",
  "active",
  "won",
  "lost",
] as const;

export const OPPORTUNITY_LIST_VIEW_OPTIONS = ["list", "pipeline"] as const;

export type OpportunityListSort =
  (typeof OPPORTUNITY_LIST_SORT_OPTIONS)[number];
export type OpportunityListScope =
  (typeof OPPORTUNITY_LIST_SCOPE_OPTIONS)[number];
export type OpportunityListView =
  (typeof OPPORTUNITY_LIST_VIEW_OPTIONS)[number];

export type OpportunitiesListSearchParams = {
  search?: string;
  stage?: string;
  owner?: string;
  company?: string;
  follow_up?: string;
  scope?: string;
  sort?: string;
  view?: string;
};

export type OpportunitiesListFilters = {
  search: string;
  stage: OpportunityStage | null;
  ownerId: string | null;
  companyId: string | null;
  overdueFollowUp: boolean;
  scope: OpportunityListScope;
  sort: OpportunityListSort;
  view: OpportunityListView;
};

export type OpportunityListStaffMember = {
  id: string;
  full_name: string | null;
};

export type OpportunityListRow = {
  id: string;
  title: string;
  company_id: string;
  company_name: string;
  stage: OpportunityStage;
  estimated_value: number | null;
  current_quote_value: number | null;
  owner_profile_id: string;
  owner_name: string;
  collaborators: OpportunityListStaffMember[];
  next_follow_up_at: string | null;
  updated_at: string;
  created_at: string;
};

function parseStageParam(value: string | undefined): OpportunityStage | null {
  if (!value) {
    return null;
  }

  return isOpportunityStage(value) ? value : null;
}

function parseSortParam(value: string | undefined): OpportunityListSort {
  if (
    value &&
    (OPPORTUNITY_LIST_SORT_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as OpportunityListSort;
  }

  return "newest";
}

function parseScopeParam(value: string | undefined): OpportunityListScope {
  if (
    value &&
    (OPPORTUNITY_LIST_SCOPE_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as OpportunityListScope;
  }

  return "all";
}

function parseViewParam(value: string | undefined): OpportunityListView {
  if (
    value &&
    (OPPORTUNITY_LIST_VIEW_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as OpportunityListView;
  }

  return "list";
}

export function parseOpportunitiesListFilters(
  params: OpportunitiesListSearchParams
): OpportunitiesListFilters {
  return {
    search: params.search?.trim() ?? "",
    stage: parseStageParam(params.stage),
    ownerId: params.owner?.trim() || null,
    companyId: params.company?.trim() || null,
    overdueFollowUp: params.follow_up === "overdue",
    scope: parseScopeParam(params.scope),
    sort: parseSortParam(params.sort),
    view: parseViewParam(params.view),
  };
}

export function hasActiveOpportunitiesListFilters(
  filters: OpportunitiesListFilters
) {
  return Boolean(
    filters.search ||
      filters.stage ||
      filters.ownerId ||
      filters.companyId ||
      filters.overdueFollowUp ||
      filters.scope !== "all" ||
      filters.sort !== "newest" ||
      filters.view !== "list"
  );
}

export function buildOpportunitiesListHref(
  filters: OpportunitiesListFilters,
  overrides: Partial<OpportunitiesListFilters> = {}
) {
  const nextFilters = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (nextFilters.search) {
    params.set("search", nextFilters.search);
  }

  if (nextFilters.stage) {
    params.set("stage", nextFilters.stage);
  }

  if (nextFilters.ownerId) {
    params.set("owner", nextFilters.ownerId);
  }

  if (nextFilters.companyId) {
    params.set("company", nextFilters.companyId);
  }

  if (nextFilters.overdueFollowUp) {
    params.set("follow_up", "overdue");
  }

  if (nextFilters.scope !== "all") {
    params.set("scope", nextFilters.scope);
  }

  if (nextFilters.sort !== "newest") {
    params.set("sort", nextFilters.sort);
  }

  if (nextFilters.view !== "list") {
    params.set("view", nextFilters.view);
  }

  const query = params.toString();

  return query ? `/admin/opportunities?${query}` : "/admin/opportunities";
}

type OpportunityRecord = {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  estimated_value: number | string | null;
  stage: OpportunityStage;
  owner_profile_id: string;
  next_follow_up_at: string | null;
  created_at: string;
  updated_at: string;
};

function sanitizeIlikeTerm(value: string) {
  return value.replace(/[%_,]/g, " ").trim();
}

async function resolveSearchMatchingOpportunityIds(
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

  const { data: byTitleOrDescription } = await supabase
    .from("opportunities")
    .select("id")
    .or(`title.ilike.${ilikePattern},description.ilike.${ilikePattern}`);

  byTitleOrDescription?.forEach((row) => matchingIds.add(row.id));

  const { data: companies } = await supabase
    .from("companies")
    .select("id")
    .ilike("company_name", ilikePattern);

  const companyIds = (companies ?? []).map((company) => company.id);

  if (companyIds.length > 0) {
    const { data: byCompany } = await supabase
      .from("opportunities")
      .select("id")
      .in("company_id", companyIds);

    byCompany?.forEach((row) => matchingIds.add(row.id));
  }

  return [...matchingIds];
}

function parseNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function sortOpportunityRows(
  rows: OpportunityListRow[],
  sort: OpportunityListSort
) {
  const sorted = [...rows];

  switch (sort) {
    case "oldest":
      sorted.sort(
        (left, right) =>
          new Date(left.created_at).getTime() -
          new Date(right.created_at).getTime()
      );
      break;
    case "highest_value":
      sorted.sort(
        (left, right) =>
          (right.estimated_value ?? -1) - (left.estimated_value ?? -1)
      );
      break;
    case "lowest_value":
      sorted.sort(
        (left, right) =>
          (left.estimated_value ?? Number.MAX_SAFE_INTEGER) -
          (right.estimated_value ?? Number.MAX_SAFE_INTEGER)
      );
      break;
    case "follow_up_soonest":
      sorted.sort((left, right) => {
        if (!left.next_follow_up_at && !right.next_follow_up_at) {
          return 0;
        }

        if (!left.next_follow_up_at) {
          return 1;
        }

        if (!right.next_follow_up_at) {
          return -1;
        }

        return (
          new Date(left.next_follow_up_at).getTime() -
          new Date(right.next_follow_up_at).getTime()
        );
      });
      break;
    case "recently_updated":
      sorted.sort(
        (left, right) =>
          new Date(right.updated_at).getTime() -
          new Date(left.updated_at).getTime()
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

export async function fetchOpportunitiesList(
  supabase: SupabaseClient,
  filters: OpportunitiesListFilters
) {
  let query = supabase.from("opportunities").select("*");

  if (filters.scope === "active") {
    query = query.not("stage", "in", '("won","lost")');
  } else if (filters.scope === "won") {
    query = query.eq("stage", "won");
  } else if (filters.scope === "lost") {
    query = query.eq("stage", "lost");
  }

  if (filters.stage) {
    query = query.eq("stage", filters.stage);
  }

  if (filters.ownerId) {
    query = query.eq("owner_profile_id", filters.ownerId);
  }

  if (filters.companyId) {
    query = query.eq("company_id", filters.companyId);
  }

  if (filters.overdueFollowUp) {
    query = query
      .lt("next_follow_up_at", new Date().toISOString())
      .not("stage", "in", '("won","lost")');
  }

  if (filters.search) {
    const matchingIds = await resolveSearchMatchingOpportunityIds(
      supabase,
      filters.search
    );

    if (matchingIds !== null) {
      if (matchingIds.length === 0) {
        return {
          opportunities: [] as OpportunityListRow[],
          totalCount: 0,
          queryError: null as string | null,
        };
      }

      query = query.in("id", matchingIds);
    }
  }

  const { data: opportunityRows, error: opportunitiesError } = await query;

  if (opportunitiesError) {
    return {
      opportunities: [] as OpportunityListRow[],
      totalCount: 0,
      queryError: opportunitiesError.message,
    };
  }

  const records = (opportunityRows ?? []) as OpportunityRecord[];

  if (records.length === 0) {
    return {
      opportunities: [] as OpportunityListRow[],
      totalCount: 0,
      queryError: null,
    };
  }

  const opportunityIds = records.map((record) => record.id);
  const companyIds = [...new Set(records.map((record) => record.company_id))];
  const ownerIds = [
    ...new Set(records.map((record) => record.owner_profile_id)),
  ];

  const [
    { data: companies },
    { data: owners },
    { data: members },
    { data: quotes },
  ] = await Promise.all([
    supabase.from("companies").select("id, company_name").in("id", companyIds),
    supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ownerIds),
    supabase
      .from("opportunity_members")
      .select("opportunity_id, profile_id")
      .in("opportunity_id", opportunityIds),
    supabase
      .from("quotes")
      .select("id, opportunity_id, current_version")
      .in("opportunity_id", opportunityIds),
  ]);

  const companyNameById = new Map(
    (companies ?? []).map((company) => [company.id, company.company_name])
  );
  const ownerNameById = new Map(
    (owners ?? []).map((owner) => [
      owner.id,
      owner.full_name?.trim() || "Unnamed staff member",
    ])
  );

  const memberProfileIds = [
    ...new Set((members ?? []).map((member) => member.profile_id)),
  ];

  let collaboratorNameById = new Map<string, string>();

  if (memberProfileIds.length > 0) {
    const { data: collaboratorProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", memberProfileIds);

    collaboratorNameById = new Map(
      (collaboratorProfiles ?? []).map((profile) => [
        profile.id,
        profile.full_name?.trim() || "Unnamed staff member",
      ])
    );
  }

  const membersByOpportunity = new Map<string, OpportunityListStaffMember[]>();

  (members ?? []).forEach((member) => {
    const existing = membersByOpportunity.get(member.opportunity_id) ?? [];
    existing.push({
      id: member.profile_id,
      full_name: collaboratorNameById.get(member.profile_id) ?? null,
    });
    membersByOpportunity.set(member.opportunity_id, existing);
  });

  const quoteValueByOpportunity = new Map<string, number>();

  const quoteRows = quotes ?? [];

  if (quoteRows.length > 0) {
    const versionLookups = quoteRows.map((quote) => ({
      quote_id: quote.id,
      version_number: quote.current_version,
      opportunity_id: quote.opportunity_id,
    }));

    const quoteIds = quoteRows.map((quote) => quote.id);
    const { data: versions } = await supabase
      .from("quote_versions")
      .select("quote_id, version_number, total")
      .in("quote_id", quoteIds);

    const versionTotalByKey = new Map<string, number>();

    (versions ?? []).forEach((version) => {
      const key = `${version.quote_id}:${version.version_number}`;
      versionTotalByKey.set(
        key,
        parseNumericValue(version.total) ?? 0
      );
    });

    versionLookups.forEach((lookup) => {
      if (!lookup.opportunity_id) {
        return;
      }

      const key = `${lookup.quote_id}:${lookup.version_number}`;
      const total = versionTotalByKey.get(key) ?? 0;
      const existing = quoteValueByOpportunity.get(lookup.opportunity_id) ?? 0;
      quoteValueByOpportunity.set(
        lookup.opportunity_id,
        Math.max(existing, total)
      );
    });
  }

  const rows: OpportunityListRow[] = records.map((record) => ({
    id: record.id,
    title: record.title,
    company_id: record.company_id,
    company_name: companyNameById.get(record.company_id) ?? "Unknown company",
    stage: record.stage,
    estimated_value: parseNumericValue(record.estimated_value),
    current_quote_value: quoteValueByOpportunity.get(record.id) ?? null,
    owner_profile_id: record.owner_profile_id,
    owner_name:
      ownerNameById.get(record.owner_profile_id) ?? "Unnamed staff member",
    collaborators: membersByOpportunity.get(record.id) ?? [],
    next_follow_up_at: record.next_follow_up_at,
    updated_at: record.updated_at,
    created_at: record.created_at,
  }));

  return {
    opportunities: sortOpportunityRows(rows, filters.sort),
    totalCount: rows.length,
    queryError: null,
  };
}

export function getOpportunityStageFilterOptions() {
  return OPPORTUNITY_STAGES.map((stage) => ({ value: stage }));
}

export function formatOpportunitySortLabel(sort: OpportunityListSort) {
  switch (sort) {
    case "newest":
      return "Newest first";
    case "oldest":
      return "Oldest first";
    case "highest_value":
      return "Highest estimated value";
    case "lowest_value":
      return "Lowest estimated value";
    case "follow_up_soonest":
      return "Next follow-up soonest";
    case "recently_updated":
      return "Recently updated";
    default:
      return sort;
  }
}
