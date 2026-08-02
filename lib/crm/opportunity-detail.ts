import type { SupabaseClient } from "@supabase/supabase-js";

import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import type {
  OpportunityActivityRecord,
  OpportunityNoteRecord,
  OpportunityRecord,
  OpportunityStage,
  TaskRecord,
} from "@/lib/crm/types";

export type OpportunityDetailStaffMember = {
  id: string;
  full_name: string | null;
};

export type OpportunityDetailTask = TaskRecord;

export type OpportunityDetailNote = OpportunityNoteRecord & {
  author_name: string;
};

export type OpportunityDetailActivity = OpportunityActivityRecord & {
  author_name: string | null;
};

export type OpportunityDetailQuoteRequest = {
  id: string;
  project_name: string;
  status: string;
  created_at: string;
};

export type OpportunityDetailQuote = {
  id: string;
  quote_number: number;
  project_name: string;
  status: string;
  current_version_total: number | null;
  updated_at: string;
};

export type OpportunityDetailData = {
  opportunity: OpportunityRecord;
  company_name: string;
  owner: OpportunityDetailStaffMember;
  collaborators: OpportunityDetailStaffMember[];
  tasks: OpportunityDetailTask[];
  notes: OpportunityDetailNote[];
  activity: OpportunityDetailActivity[];
  quoteRequests: OpportunityDetailQuoteRequest[];
  quotes: OpportunityDetailQuote[];
  current_quote_value: number | null;
};

function parseNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export async function loadOpportunityDetail(
  supabase: SupabaseClient,
  opportunityId: string
): Promise<OpportunityDetailData | null> {
  const { data: opportunity, error: opportunityError } = await supabase
    .from("opportunities")
    .select("*")
    .eq("id", opportunityId)
    .maybeSingle();

  if (opportunityError || !opportunity) {
    return null;
  }

  const typedOpportunity = opportunity as OpportunityRecord;

  const [
    { data: company },
    { data: owner },
    { data: members },
    { data: tasks },
    { data: notes },
    { data: activity },
    { data: quoteRequests },
    { data: quotes },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("company_name")
      .eq("id", typedOpportunity.company_id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("id", typedOpportunity.owner_profile_id)
      .maybeSingle(),
    supabase
      .from("opportunity_members")
      .select("profile_id")
      .eq("opportunity_id", opportunityId),
    supabase
      .from("tasks")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .order("due_at", { ascending: true, nullsFirst: false }),
    supabase
      .from("opportunity_notes")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: false }),
    supabase
      .from("opportunity_activity")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: false }),
    supabase
      .from("quote_requests")
      .select("id, project_name, status, created_at")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: false }),
    supabase
      .from("quotes")
      .select("id, quote_number, project_name, status, current_version, updated_at")
      .eq("opportunity_id", opportunityId)
      .order("updated_at", { ascending: false }),
  ]);

  const memberProfileIds = (members ?? []).map((member) => member.profile_id);
  let collaborators: OpportunityDetailStaffMember[] = [];

  if (memberProfileIds.length > 0) {
    const { data: collaboratorProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", memberProfileIds);

    collaborators = (collaboratorProfiles ?? []) as OpportunityDetailStaffMember[];
  }

  const noteAuthorIds = [
    ...new Set((notes ?? []).map((note) => note.created_by)),
  ];
  const activityAuthorIds = [
    ...new Set(
      (activity ?? [])
        .map((entry) => entry.created_by)
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const authorIds = [...new Set([...noteAuthorIds, ...activityAuthorIds])];

  let authorNameById = new Map<string, string>();

  if (authorIds.length > 0) {
    const { data: authorProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);

    authorNameById = new Map(
      (authorProfiles ?? []).map((profile) => [
        profile.id,
        getStaffDisplayName(profile),
      ])
    );
  }

  const quoteRows = quotes ?? [];
  let currentQuoteValue: number | null = null;
  const enrichedQuotes: OpportunityDetailQuote[] = [];

  if (quoteRows.length > 0) {
    const quoteIds = quoteRows.map((quote) => quote.id);
    const { data: versions } = await supabase
      .from("quote_versions")
      .select("quote_id, version_number, total")
      .in("quote_id", quoteIds);

    const versionTotalByKey = new Map<string, number>();

    (versions ?? []).forEach((version) => {
      versionTotalByKey.set(
        `${version.quote_id}:${version.version_number}`,
        parseNumericValue(version.total) ?? 0
      );
    });

    quoteRows.forEach((quote) => {
      const total =
        versionTotalByKey.get(`${quote.id}:${quote.current_version}`) ?? null;

      if (total !== null) {
        currentQuoteValue =
          currentQuoteValue === null
            ? total
            : Math.max(currentQuoteValue, total);
      }

      enrichedQuotes.push({
        id: quote.id,
        quote_number: quote.quote_number,
        project_name: quote.project_name,
        status: quote.status,
        current_version_total: total,
        updated_at: quote.updated_at,
      });
    });
  }

  return {
    opportunity: {
      ...typedOpportunity,
      stage: typedOpportunity.stage as OpportunityStage,
    },
    company_name: company?.company_name ?? "Unknown company",
    owner: (owner ?? {
      id: typedOpportunity.owner_profile_id,
      full_name: null,
    }) as OpportunityDetailStaffMember,
    collaborators,
    tasks: (tasks ?? []) as OpportunityDetailTask[],
    notes: (notes ?? []).map((note) => ({
      ...(note as OpportunityNoteRecord),
      author_name: authorNameById.get(note.created_by) ?? "Unknown author",
    })),
    activity: (activity ?? []).map((entry) => ({
      ...(entry as OpportunityActivityRecord),
      author_name: entry.created_by
        ? authorNameById.get(entry.created_by) ?? null
        : null,
    })),
    quoteRequests: (quoteRequests ?? []) as OpportunityDetailQuoteRequest[],
    quotes: enrichedQuotes,
    current_quote_value: currentQuoteValue,
  };
}

export async function loadOpportunityCollaboratorIds(
  supabase: SupabaseClient,
  opportunityId: string
) {
  const { data: members } = await supabase
    .from("opportunity_members")
    .select("profile_id")
    .eq("opportunity_id", opportunityId);

  return (members ?? []).map((member) => member.profile_id);
}
