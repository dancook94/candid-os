import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdminQuoteListRow } from "@/lib/admin-quotes-list";
import { fetchAdminQuotesList } from "@/lib/admin-quotes-list";
import { formatGbp, formatQuoteCount } from "@/lib/format-currency";
import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import { getLondonDayBounds } from "@/lib/crm/day-bounds";
import {
  fetchOpportunitiesList,
  type OpportunityListRow,
} from "@/lib/crm/opportunities-list";
import { OPEN_TASK_STATUSES } from "@/lib/crm/task-config";
import {
  loadTaskAssigneesByTaskIds,
  type TaskAssigneeProfile,
} from "@/lib/crm/task-assignees";
import type { TaskPriority, TaskStatus } from "@/lib/crm/types";
import { createAdminClient } from "@/lib/supabase/admin";

const TERMINAL_STAGE_FILTER = '("won","lost")';

type QuoteMetricRow = {
  id: string;
  current_version: number;
  status: string;
};

type VersionRow = {
  quote_id: string;
  version_number: number;
  version_status: string;
  total: number | string | null;
};

export type Company360QuoteMetric = {
  totalValue: number;
  quoteCount: number;
  formattedValue: string;
  formattedQuoteCount: string;
};

export type Company360Summary = {
  activeOpportunitiesCount: number;
  activePipelineValue: number;
  quotesSent: Company360QuoteMetric;
  quotesAccepted: Company360QuoteMetric;
  quotesDeclined: Company360QuoteMetric;
  openTasksCount: number;
  overdueTasksCount: number;
};

export type Company360PortalUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  account_status: string;
  last_sign_in_at: string | null;
};

export type Company360ActivityCategory =
  | "opportunities"
  | "quotes"
  | "tasks"
  | "notes";

export type Company360ActivityItem = {
  id: string;
  source: "activity" | "note";
  category: Company360ActivityCategory;
  activity_type: string;
  description: string;
  author_name: string | null;
  created_at: string;
  opportunity_id: string;
  opportunity_title: string | null;
  quote_id: string | null;
  quote_label: string | null;
};

export type Company360Task = {
  id: string;
  title: string;
  assignees: TaskAssigneeProfile[];
  due_at: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  opportunity_id: string | null;
  opportunity_title: string | null;
  isOverdue: boolean;
  isDueToday: boolean;
};

export type Company360Data = {
  summary: Company360Summary;
  opportunities: OpportunityListRow[];
  quotes: AdminQuoteListRow[];
  tasks: Company360Task[];
  portalUsers: Company360PortalUser[];
  activity: Company360ActivityItem[];
  errors: string[];
};

function parseNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function emptyQuoteMetric(): Company360QuoteMetric {
  return {
    totalValue: 0,
    quoteCount: 0,
    formattedValue: formatGbp(0),
    formattedQuoteCount: formatQuoteCount(0),
  };
}

function buildQuoteMetric(rows: { total: number }[]): Company360QuoteMetric {
  const totalValue = rows.reduce((sum, row) => sum + row.total, 0);

  return {
    totalValue,
    quoteCount: rows.length,
    formattedValue: formatGbp(totalValue),
    formattedQuoteCount: formatQuoteCount(rows.length),
  };
}

function matchCurrentVersion(
  quote: QuoteMetricRow,
  version: VersionRow,
  expectedQuoteStatus: string,
  expectedVersionStatus: string
) {
  return (
    quote.status === expectedQuoteStatus &&
    version.version_number === quote.current_version &&
    version.version_status === expectedVersionStatus
  );
}

async function fetchCompanyQuoteMetrics(
  supabase: SupabaseClient,
  companyId: string,
  errors: string[]
) {
  const [
    { data: sentQuotes, error: sentQuotesError },
    { data: acceptedQuotes, error: acceptedQuotesError },
    { data: declinedQuotes, error: declinedQuotesError },
  ] = await Promise.all([
    supabase
      .from("quotes")
      .select("id, current_version, status")
      .eq("company_id", companyId)
      .eq("status", "sent"),
    supabase
      .from("quotes")
      .select("id, current_version, status")
      .eq("company_id", companyId)
      .eq("status", "accepted"),
    supabase
      .from("quotes")
      .select("id, current_version, status")
      .eq("company_id", companyId)
      .eq("status", "declined"),
  ]);

  if (sentQuotesError) {
    errors.push(`Quotes sent: ${sentQuotesError.message}`);
  }

  if (acceptedQuotesError) {
    errors.push(`Quotes accepted: ${acceptedQuotesError.message}`);
  }

  if (declinedQuotesError) {
    errors.push(`Quotes declined: ${declinedQuotesError.message}`);
  }

  const relevantQuotes = [
    ...(sentQuotes ?? []),
    ...(acceptedQuotes ?? []),
    ...(declinedQuotes ?? []),
  ];

  if (relevantQuotes.length === 0) {
    return {
      quotesSent: emptyQuoteMetric(),
      quotesAccepted: emptyQuoteMetric(),
      quotesDeclined: emptyQuoteMetric(),
    };
  }

  const quoteById = new Map(
    relevantQuotes.map((quote) => [quote.id, quote as QuoteMetricRow])
  );

  const { data: versions, error: versionsError } = await supabase
    .from("quote_versions")
    .select("quote_id, version_number, version_status, total")
    .in(
      "quote_id",
      relevantQuotes.map((quote) => quote.id)
    );

  if (versionsError) {
    errors.push(`Quote versions: ${versionsError.message}`);

    return {
      quotesSent: emptyQuoteMetric(),
      quotesAccepted: emptyQuoteMetric(),
      quotesDeclined: emptyQuoteMetric(),
    };
  }

  const sentRows: { total: number }[] = [];
  const acceptedRows: { total: number }[] = [];
  const declinedRows: { total: number }[] = [];

  for (const version of versions ?? []) {
    const quote = quoteById.get(version.quote_id);

    if (!quote) {
      continue;
    }

    const total = Number(version.total ?? 0);

    if (matchCurrentVersion(quote, version, "sent", "sent")) {
      sentRows.push({ total });
      continue;
    }

    if (matchCurrentVersion(quote, version, "accepted", "accepted")) {
      acceptedRows.push({ total });
      continue;
    }

    if (matchCurrentVersion(quote, version, "declined", "declined")) {
      declinedRows.push({ total });
    }
  }

  return {
    quotesSent: buildQuoteMetric(sentRows),
    quotesAccepted: buildQuoteMetric(acceptedRows),
    quotesDeclined: buildQuoteMetric(declinedRows),
  };
}

function getTaskAttentionSortKey(
  dueAt: string | null,
  nowMs: number,
  todayStartMs: number,
  todayEndMs: number
) {
  if (!dueAt) {
    return [3, Number.MAX_SAFE_INTEGER] as const;
  }

  const dueMs = new Date(dueAt).getTime();

  if (dueMs < nowMs) {
    return [0, dueMs] as const;
  }

  if (dueMs >= todayStartMs && dueMs <= todayEndMs) {
    return [1, dueMs] as const;
  }

  if (dueMs > todayEndMs) {
    return [2, dueMs] as const;
  }

  return [3, dueMs] as const;
}

function categorizeActivityType(
  activityType: string
): Company360ActivityCategory {
  if (activityType === "note_added") {
    return "notes";
  }

  if (activityType.startsWith("task_")) {
    return "tasks";
  }

  if (activityType.startsWith("quote_")) {
    return "quotes";
  }

  return "opportunities";
}

function extractQuoteId(metadata: Record<string, unknown> | null | undefined) {
  const quoteId = metadata?.quote_id;
  return typeof quoteId === "string" ? quoteId : null;
}

async function loadCompanyPortalUsers(
  companyId: string,
  errors: string[]
): Promise<Company360PortalUser[]> {
  let adminClient;

  try {
    adminClient = createAdminClient();
  } catch (error) {
    errors.push(
      error instanceof Error
        ? `Portal users auth: ${error.message}`
        : "Portal users auth unavailable."
    );
    return [];
  }

  const { data: profiles, error: profilesError } = await adminClient
    .from("profiles")
    .select("id, full_name, account_status")
    .eq("company_id", companyId)
    .in("account_status", ["approved", "pending"])
    .order("full_name", { ascending: true });

  if (profilesError) {
    errors.push(`Portal users: ${profilesError.message}`);
    return [];
  }

  return Promise.all(
    (profiles ?? []).map(async (profile) => {
      const { data: authData, error: authError } =
        await adminClient.auth.admin.getUserById(profile.id);

      if (authError) {
        return {
          id: profile.id,
          full_name: profile.full_name,
          email: null,
          account_status: profile.account_status,
          last_sign_in_at: null,
        };
      }

      return {
        id: profile.id,
        full_name: profile.full_name,
        email: authData.user.email ?? null,
        account_status: profile.account_status,
        last_sign_in_at: authData.user.last_sign_in_at ?? null,
      };
    })
  );
}

async function fetchCompanyTasks(
  supabase: SupabaseClient,
  companyId: string,
  opportunityIds: string[],
  quoteIds: string[],
  opportunityTitleById: Map<string, string>,
  errors: string[]
): Promise<Company360Task[]> {
  const orParts = [`company_id.eq.${companyId}`];

  if (opportunityIds.length > 0) {
    orParts.push(`opportunity_id.in.(${opportunityIds.join(",")})`);
  }

  if (quoteIds.length > 0) {
    orParts.push(`quote_id.in.(${quoteIds.join(",")})`);
  }

  const { data: taskRows, error: tasksError } = await supabase
    .from("tasks")
    .select("*")
    .or(orParts.join(","))
    .in("status", OPEN_TASK_STATUSES);

  if (tasksError) {
    errors.push(`Company tasks: ${tasksError.message}`);
    return [];
  }

  const records = taskRows ?? [];

  if (records.length === 0) {
    return [];
  }

  const assigneesByTaskId = await loadTaskAssigneesByTaskIds(
    supabase,
    records.map((task) => task.id)
  );

  const nowMs = Date.now();
  const { start: todayStartIso, end: todayEndIso } = getLondonDayBounds();
  const todayStartMs = new Date(todayStartIso).getTime();
  const todayEndMs = new Date(todayEndIso).getTime();

  const tasks: Company360Task[] = records.map((task) => {
    const dueAt = task.due_at as string | null;
    const dueMs = dueAt ? new Date(dueAt).getTime() : null;

    return {
      id: task.id,
      title: task.title,
      assignees: assigneesByTaskId.get(task.id) ?? [],
      due_at: dueAt,
      priority: task.priority as TaskPriority,
      status: task.status as TaskStatus,
      opportunity_id: task.opportunity_id,
      opportunity_title: task.opportunity_id
        ? opportunityTitleById.get(task.opportunity_id) ?? null
        : null,
      isOverdue: dueMs !== null && dueMs < nowMs,
      isDueToday:
        dueMs !== null && dueMs >= todayStartMs && dueMs <= todayEndMs,
    };
  });

  tasks.sort((left, right) => {
    const leftKey = getTaskAttentionSortKey(
      left.due_at,
      nowMs,
      todayStartMs,
      todayEndMs
    );
    const rightKey = getTaskAttentionSortKey(
      right.due_at,
      nowMs,
      todayStartMs,
      todayEndMs
    );

    if (leftKey[0] !== rightKey[0]) {
      return leftKey[0] - rightKey[0];
    }

    return leftKey[1] - rightKey[1];
  });

  return tasks;
}

async function fetchCompanyActivity(
  supabase: SupabaseClient,
  opportunityIds: string[],
  opportunityTitleById: Map<string, string>,
  quoteLabelById: Map<string, string>,
  errors: string[]
): Promise<Company360ActivityItem[]> {
  if (opportunityIds.length === 0) {
    return [];
  }

  const [{ data: activityRows, error: activityError }, { data: noteRows, error: notesError }] =
    await Promise.all([
      supabase
        .from("opportunity_activity")
        .select("*")
        .in("opportunity_id", opportunityIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("opportunity_notes")
        .select("*")
        .in("opportunity_id", opportunityIds)
        .order("created_at", { ascending: false }),
    ]);

  if (activityError) {
    errors.push(`Company activity: ${activityError.message}`);
  }

  if (notesError) {
    errors.push(`Company notes: ${notesError.message}`);
  }

  const authorIds = [
    ...new Set([
      ...(activityRows ?? [])
        .map((entry) => entry.created_by)
        .filter((value): value is string => Boolean(value)),
      ...(noteRows ?? []).map((note) => note.created_by),
    ]),
  ];

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

  const activityItems: Company360ActivityItem[] = (activityRows ?? []).map(
    (entry) => {
      const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
      const quoteId = extractQuoteId(metadata);

      return {
        id: `activity:${entry.id}`,
        source: "activity",
        category: categorizeActivityType(entry.activity_type),
        activity_type: entry.activity_type,
        description: entry.description,
        author_name: entry.created_by
          ? authorNameById.get(entry.created_by) ?? null
          : null,
        created_at: entry.created_at,
        opportunity_id: entry.opportunity_id,
        opportunity_title:
          opportunityTitleById.get(entry.opportunity_id) ?? null,
        quote_id: quoteId,
        quote_label: quoteId ? quoteLabelById.get(quoteId) ?? null : null,
      };
    }
  );

  const noteItems: Company360ActivityItem[] = (noteRows ?? []).map((note) => ({
    id: `note:${note.id}`,
    source: "note",
    category: "notes",
    activity_type: "note",
    description: note.body,
    author_name: authorNameById.get(note.created_by) ?? null,
    created_at: note.created_at,
    opportunity_id: note.opportunity_id,
    opportunity_title: opportunityTitleById.get(note.opportunity_id) ?? null,
    quote_id: null,
    quote_label: null,
  }));

  return [...activityItems, ...noteItems].sort(
    (left, right) =>
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );
}

export async function fetchCompany360(
  supabase: SupabaseClient,
  companyId: string
): Promise<Company360Data> {
  const errors: string[] = [];

  const [
    quoteMetrics,
    { count: activeOpportunitiesCount, error: activeCountError },
    { data: activeOpportunityRows, error: activeRowsError },
    opportunitiesResult,
    quotesResult,
    portalUsers,
    { data: companyOpportunityIds, error: opportunityIdsError },
    { data: companyQuoteIds, error: quoteIdsError },
  ] = await Promise.all([
    fetchCompanyQuoteMetrics(supabase, companyId, errors),
    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .not("stage", "in", TERMINAL_STAGE_FILTER),
    supabase
      .from("opportunities")
      .select("estimated_value")
      .eq("company_id", companyId)
      .not("stage", "in", TERMINAL_STAGE_FILTER),
    fetchOpportunitiesList(supabase, {
      search: "",
      stage: null,
      ownerId: null,
      companyId,
      overdueFollowUp: false,
      scope: "all",
      sort: "recently_updated",
      view: "list",
    }),
    fetchAdminQuotesList(supabase, {
      search: "",
      status: null,
      companyId,
      fromDate: null,
      toDate: null,
      sort: "newest",
      opportunityLink: "all",
    }),
    loadCompanyPortalUsers(companyId, errors),
    supabase.from("opportunities").select("id, title").eq("company_id", companyId),
    supabase.from("quotes").select("id, quote_number").eq("company_id", companyId),
  ]);

  if (activeCountError) {
    errors.push(`Active opportunities count: ${activeCountError.message}`);
  }

  if (activeRowsError) {
    errors.push(`Active pipeline value: ${activeRowsError.message}`);
  }

  if (opportunityIdsError) {
    errors.push(`Opportunity ids: ${opportunityIdsError.message}`);
  }

  if (quoteIdsError) {
    errors.push(`Quote ids: ${quoteIdsError.message}`);
  }

  if (opportunitiesResult.queryError) {
    errors.push(`Opportunities: ${opportunitiesResult.queryError}`);
  }

  if (quotesResult.queryError) {
    errors.push(`Quotes: ${quotesResult.queryError}`);
  }

  const activePipelineValue = (activeOpportunityRows ?? []).reduce(
    (sum, row) => sum + (parseNumericValue(row.estimated_value) ?? 0),
    0
  );

  const opportunityTitleById = new Map(
    (companyOpportunityIds ?? []).map((opportunity) => [
      opportunity.id,
      opportunity.title,
    ])
  );
  const opportunityIds = [...opportunityTitleById.keys()];
  const quoteLabelById = new Map(
    (companyQuoteIds ?? []).map((quote) => [
      quote.id,
      `Q-${quote.quote_number}`,
    ])
  );
  const quoteIds = [...quoteLabelById.keys()];

  const [tasks, activity] = await Promise.all([
    fetchCompanyTasks(
      supabase,
      companyId,
      opportunityIds,
      quoteIds,
      opportunityTitleById,
      errors
    ),
    fetchCompanyActivity(
      supabase,
      opportunityIds,
      opportunityTitleById,
      quoteLabelById,
      errors
    ),
  ]);

  const opportunities = opportunitiesResult.opportunities.filter(
    (opportunity) =>
      opportunity.stage !== "won" && opportunity.stage !== "lost"
  );

  return {
    summary: {
      activeOpportunitiesCount: activeOpportunitiesCount ?? 0,
      activePipelineValue,
      quotesSent: quoteMetrics.quotesSent,
      quotesAccepted: quoteMetrics.quotesAccepted,
      quotesDeclined: quoteMetrics.quotesDeclined,
      openTasksCount: tasks.length,
      overdueTasksCount: tasks.filter((task) => task.isOverdue).length,
    },
    opportunities,
    quotes: quotesResult.quotes,
    tasks,
    portalUsers,
    activity,
    errors,
  };
}
