import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdminQuoteListRow } from "@/lib/admin-quotes-list";
import { fetchAdminQuotesList } from "@/lib/admin-quotes-list";
import { formatGbp, formatQuoteCount } from "@/lib/format-currency";
import type { CrmNoteListItem, CrmTimelineItem } from "@/lib/crm/get-crm-timeline";
import { getCrmNotes, getCrmTimeline } from "@/lib/crm/get-crm-timeline";
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
import {
  fetchContactsList,
  type ContactListRow,
} from "@/lib/crm/contacts";

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

export type Company360Contact = ContactListRow;

export type Company360ActivityItem = CrmTimelineItem;

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
  contacts: Company360Contact[];
  activity: Company360ActivityItem[];
  notes: CrmNoteListItem[];
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

async function fetchCompanyCrmFeed(
  supabase: SupabaseClient,
  companyId: string,
  errors: string[],
  options?: { currentUserId?: string; isAdmin?: boolean }
) {
  try {
    const [{ items: activity }, notes] = await Promise.all([
      getCrmTimeline(supabase, {
        scope: { type: "company", companyId },
        limit: 50,
      }),
      getCrmNotes(supabase, {
        scope: { type: "company", companyId },
        currentUserId: options?.currentUserId,
        isAdmin: options?.isAdmin,
      }),
    ]);

    return { activity, notes };
  } catch (error) {
    errors.push(
      `Company CRM feed: ${
        error instanceof Error ? error.message : "Unable to load CRM feed."
      }`
    );

    return { activity: [], notes: [] };
  }
}

async function loadCompanyContacts(
  supabase: SupabaseClient,
  companyId: string,
  errors: string[]
): Promise<Company360Contact[]> {
  const { contacts, queryError } = await fetchContactsList(supabase, {
    companyId,
  });

  if (queryError) {
    errors.push(`Contacts: ${queryError}`);
  }

  return contacts;
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

export async function fetchCompany360(
  supabase: SupabaseClient,
  companyId: string,
  options?: { currentUserId?: string; isAdmin?: boolean }
): Promise<Company360Data> {
  const errors: string[] = [];

  const [
    quoteMetrics,
    { count: activeOpportunitiesCount, error: activeCountError },
    { data: activeOpportunityRows, error: activeRowsError },
    opportunitiesResult,
    quotesResult,
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

  const [contacts, tasks, crmFeed] = await Promise.all([
    loadCompanyContacts(supabase, companyId, errors),
    fetchCompanyTasks(
      supabase,
      companyId,
      opportunityIds,
      quoteIds,
      opportunityTitleById,
      errors
    ),
    fetchCompanyCrmFeed(supabase, companyId, errors, options),
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
    contacts,
    activity: crmFeed.activity,
    notes: crmFeed.notes,
    errors,
  };
}
