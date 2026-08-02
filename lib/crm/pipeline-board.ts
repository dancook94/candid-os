import type { SupabaseClient } from "@supabase/supabase-js";

import type { OpportunitySource, OpportunityStage } from "@/lib/crm/types";
import { isOpportunityStage } from "@/lib/crm/opportunity-stages";
import { OPPORTUNITY_STAGES } from "@/lib/crm/types";
import { OPEN_TASK_STATUSES } from "@/lib/crm/task-config";

export const PIPELINE_QUICK_FILTERS = [
  "my",
  "needs_follow_up",
  "no_task",
  "closing_this_month",
  "won",
  "lost",
] as const;

export type PipelineQuickFilter = (typeof PIPELINE_QUICK_FILTERS)[number];

export type PipelineBoardSearchParams = {
  search?: string;
  stage?: string;
  owner?: string;
  collaborator?: string;
  company?: string;
  source?: string;
  follow_up?: string;
  no_task?: string;
  expected_close?: string;
  quick?: string;
  view?: string;
};

export type PipelineBoardFilters = {
  search: string;
  stage: OpportunityStage | null;
  ownerId: string | null;
  collaboratorId: string | null;
  companyId: string | null;
  source: OpportunitySource | null;
  overdueFollowUp: boolean;
  noFutureTask: boolean;
  expectedCloseMonth: string | null;
  quickFilter: PipelineQuickFilter | null;
};

export type PipelineCardTask = {
  id: string;
  title: string;
  due_at: string | null;
  priority: string;
  status: string;
};

export type PipelineCard = {
  id: string;
  title: string;
  company_id: string;
  company_name: string;
  stage: OpportunityStage;
  estimated_value: number | null;
  current_quote_value: number | null;
  owner_profile_id: string;
  owner_name: string;
  collaborators: { id: string; full_name: string | null }[];
  next_follow_up_at: string | null;
  updated_at: string;
  source: OpportunitySource;
  expected_close_date: string | null;
  days_since_update: number;
  is_follow_up_overdue: boolean;
  is_task_overdue: boolean;
  has_urgent_task: boolean;
  next_incomplete_task: PipelineCardTask | null;
};

export type PipelineColumnTotals = {
  count: number;
  estimatedTotal: number;
  quoteTotal: number;
};

export type PipelineBoardData = {
  columns: Record<OpportunityStage, PipelineCard[]>;
  totals: Record<OpportunityStage, PipelineColumnTotals>;
};

function parseQuickFilter(value: string | undefined): PipelineQuickFilter | null {
  if (!value) {
    return null;
  }

  return (PIPELINE_QUICK_FILTERS as readonly string[]).includes(value)
    ? (value as PipelineQuickFilter)
    : null;
}

function parseSourceParam(value: string | undefined): OpportunitySource | null {
  const sources = [
    "customer_portal",
    "admin",
    "phone",
    "email",
    "referral",
    "walk_in",
    "other",
  ] as const;

  if (!value) {
    return null;
  }

  return (sources as readonly string[]).includes(value)
    ? (value as OpportunitySource)
    : null;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export function parsePipelineBoardFilters(
  params: PipelineBoardSearchParams
): PipelineBoardFilters {
  return {
    search: params.search?.trim() ?? "",
    stage: params.stage && isOpportunityStage(params.stage) ? params.stage : null,
    ownerId: params.owner?.trim() || null,
    collaboratorId: params.collaborator?.trim() || null,
    companyId: params.company?.trim() || null,
    source: parseSourceParam(params.source),
    overdueFollowUp: params.follow_up === "overdue",
    noFutureTask: params.no_task === "1",
    expectedCloseMonth:
      params.expected_close && MONTH_PATTERN.test(params.expected_close)
        ? params.expected_close
        : null,
    quickFilter: parseQuickFilter(params.quick),
  };
}

export function buildPipelineBoardHref(
  filters: PipelineBoardFilters,
  overrides: Partial<PipelineBoardFilters> = {}
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  params.set("view", "pipeline");

  if (next.search) params.set("search", next.search);
  if (next.stage) params.set("stage", next.stage);
  if (next.ownerId) params.set("owner", next.ownerId);
  if (next.collaboratorId) params.set("collaborator", next.collaboratorId);
  if (next.companyId) params.set("company", next.companyId);
  if (next.source) params.set("source", next.source);
  if (next.overdueFollowUp) params.set("follow_up", "overdue");
  if (next.noFutureTask) params.set("no_task", "1");
  if (next.expectedCloseMonth) params.set("expected_close", next.expectedCloseMonth);
  if (next.quickFilter) params.set("quick", next.quickFilter);

  return `/admin/opportunities?${params.toString()}`;
}

function parseNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysSince(dateString: string) {
  const diff = Date.now() - new Date(dateString).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function sanitizeIlikeTerm(value: string) {
  return value.replace(/[%_,]/g, " ").trim();
}

export async function fetchPipelineBoard(
  supabase: SupabaseClient,
  filters: PipelineBoardFilters,
  currentUserId: string
): Promise<{ data: PipelineBoardData; queryError: string | null }> {
  let query = supabase.from("opportunities").select("*");

  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.ownerId) query = query.eq("owner_profile_id", filters.ownerId);
  if (filters.companyId) query = query.eq("company_id", filters.companyId);
  if (filters.source) query = query.eq("source", filters.source);

  if (filters.overdueFollowUp) {
    query = query
      .lt("next_follow_up_at", new Date().toISOString())
      .not("stage", "in", '("won","lost")');
  }

  if (filters.expectedCloseMonth) {
    const [year, month] = filters.expectedCloseMonth.split("-").map(Number);
    const start = `${filters.expectedCloseMonth}-01`;
    const endDate = new Date(year, month, 0);
    const end = endDate.toISOString().slice(0, 10);
    query = query.gte("expected_close_date", start).lte("expected_close_date", end);
  }

  if (filters.quickFilter === "my") {
    query = query.eq("owner_profile_id", currentUserId);
  } else if (filters.quickFilter === "won") {
    query = query.eq("stage", "won");
  } else if (filters.quickFilter === "lost") {
    query = query.eq("stage", "lost");
  } else if (filters.quickFilter === "needs_follow_up") {
    query = query
      .lt("next_follow_up_at", new Date().toISOString())
      .not("stage", "in", '("won","lost")');
  } else if (filters.quickFilter === "closing_this_month") {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `${now.getFullYear()}-${month}`;
    query = query.like("expected_close_date", `${prefix}%`);
  }

  if (filters.search) {
    const sanitized = sanitizeIlikeTerm(filters.search);
    if (sanitized) {
      query = query.or(
        `title.ilike.%${sanitized}%,description.ilike.%${sanitized}%`
      );
    }
  }

  const { data: records, error } = await query;

  if (error) {
    return {
      data: emptyBoard(),
      queryError: error.message,
    };
  }

  let opportunityRows = records ?? [];

  if (filters.collaboratorId) {
    const { data: memberRows } = await supabase
      .from("opportunity_members")
      .select("opportunity_id")
      .eq("profile_id", filters.collaboratorId);

    const allowedIds = new Set(
      (memberRows ?? []).map((row) => row.opportunity_id)
    );
    opportunityRows = opportunityRows.filter((row) => allowedIds.has(row.id));
  }

  if (opportunityRows.length === 0) {
    return { data: emptyBoard(), queryError: null };
  }

  const opportunityIds = opportunityRows.map((row) => row.id);
  const companyIds = [...new Set(opportunityRows.map((row) => row.company_id))];
  const ownerIds = [...new Set(opportunityRows.map((row) => row.owner_profile_id))];

  const [
    { data: companies },
    { data: owners },
    { data: members },
    { data: quotes },
    { data: tasks },
  ] = await Promise.all([
    supabase.from("companies").select("id, company_name").in("id", companyIds),
    supabase.from("profiles").select("id, full_name").in("id", ownerIds),
    supabase
      .from("opportunity_members")
      .select("opportunity_id, profile_id")
      .in("opportunity_id", opportunityIds),
    supabase
      .from("quotes")
      .select("id, opportunity_id, current_version")
      .in("opportunity_id", opportunityIds),
    supabase
      .from("tasks")
      .select("id, title, due_at, priority, status, opportunity_id")
      .in("opportunity_id", opportunityIds)
      .in("status", OPEN_TASK_STATUSES)
      .order("due_at", { ascending: true }),
  ]);

  const companyNameById = new Map(
    (companies ?? []).map((c) => [c.id, c.company_name])
  );
  const ownerNameById = new Map(
    (owners ?? []).map((o) => [
      o.id,
      o.full_name?.trim() || "Unnamed staff member",
    ])
  );

  const memberProfileIds = [...new Set((members ?? []).map((m) => m.profile_id))];
  let collaboratorNameById = new Map<string, string | null>();

  if (memberProfileIds.length > 0) {
    const { data: collaboratorProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", memberProfileIds);
    collaboratorNameById = new Map(
      (collaboratorProfiles ?? []).map((p) => [p.id, p.full_name])
    );
  }

  const membersByOpportunity = new Map<
    string,
    { id: string; full_name: string | null }[]
  >();
  (members ?? []).forEach((member) => {
    const list = membersByOpportunity.get(member.opportunity_id) ?? [];
    list.push({
      id: member.profile_id,
      full_name: collaboratorNameById.get(member.profile_id) ?? null,
    });
    membersByOpportunity.set(member.opportunity_id, list);
  });

  const quoteValueByOpportunity = new Map<string, number>();
  const quoteRows = quotes ?? [];

  if (quoteRows.length > 0) {
    const quoteIds = quoteRows.map((q) => q.id);
    const { data: versions } = await supabase
      .from("quote_versions")
      .select("quote_id, version_number, total")
      .in("quote_id", quoteIds);

    const versionTotalByKey = new Map<string, number>();
    (versions ?? []).forEach((v) => {
      versionTotalByKey.set(
        `${v.quote_id}:${v.version_number}`,
        parseNumericValue(v.total) ?? 0
      );
    });

    quoteRows.forEach((quote) => {
      if (!quote.opportunity_id) return;
      const total =
        versionTotalByKey.get(`${quote.id}:${quote.current_version}`) ?? 0;
      const existing = quoteValueByOpportunity.get(quote.opportunity_id) ?? 0;
      quoteValueByOpportunity.set(quote.opportunity_id, Math.max(existing, total));
    });
  }

  const tasksByOpportunity = new Map<string, typeof tasks>();
  (tasks ?? []).forEach((task) => {
    if (!task.opportunity_id) return;
    const list = tasksByOpportunity.get(task.opportunity_id) ?? [];
    list.push(task);
    tasksByOpportunity.set(task.opportunity_id, list);
  });

  const now = Date.now();
  let cards: PipelineCard[] = opportunityRows.map((row) => {
    const oppTasks = tasksByOpportunity.get(row.id) ?? [];
    const nextTask = oppTasks[0] ?? null;
    const isFollowUpOverdue =
      row.next_follow_up_at !== null &&
      new Date(row.next_follow_up_at).getTime() < now &&
      row.stage !== "won" &&
      row.stage !== "lost";
    const isTaskOverdue =
      nextTask?.due_at !== null &&
      nextTask?.due_at !== undefined &&
      new Date(nextTask.due_at).getTime() < now;
    const hasUrgent =
      oppTasks.some((t) => t.priority === "urgent" || t.priority === "high");

    return {
      id: row.id,
      title: row.title,
      company_id: row.company_id,
      company_name: companyNameById.get(row.company_id) ?? "Unknown company",
      stage: row.stage as OpportunityStage,
      estimated_value: parseNumericValue(row.estimated_value),
      current_quote_value: quoteValueByOpportunity.get(row.id) ?? null,
      owner_profile_id: row.owner_profile_id,
      owner_name: ownerNameById.get(row.owner_profile_id) ?? "Unnamed",
      collaborators: membersByOpportunity.get(row.id) ?? [],
      next_follow_up_at: row.next_follow_up_at,
      updated_at: row.updated_at,
      source: row.source as OpportunitySource,
      expected_close_date: row.expected_close_date,
      days_since_update: daysSince(row.updated_at),
      is_follow_up_overdue: isFollowUpOverdue,
      is_task_overdue: isTaskOverdue,
      has_urgent_task: hasUrgent,
      next_incomplete_task: nextTask
        ? {
            id: nextTask.id,
            title: nextTask.title,
            due_at: nextTask.due_at,
            priority: nextTask.priority,
            status: nextTask.status,
          }
        : null,
    };
  });

  if (filters.noFutureTask || filters.quickFilter === "no_task") {
    cards = cards.filter((card) => !card.next_incomplete_task);
  }

  const columns = emptyBoard().columns;
  const totals = emptyBoard().totals;

  cards.forEach((card) => {
    columns[card.stage].push(card);
    totals[card.stage].count += 1;
    totals[card.stage].estimatedTotal += card.estimated_value ?? 0;
    totals[card.stage].quoteTotal += card.current_quote_value ?? 0;
  });

  return { data: { columns, totals }, queryError: null };
}

function emptyBoard(): PipelineBoardData {
  const columns = {} as Record<OpportunityStage, PipelineCard[]>;
  const totals = {} as Record<OpportunityStage, PipelineColumnTotals>;

  OPPORTUNITY_STAGES.forEach((stage) => {
    columns[stage] = [];
    totals[stage] = { count: 0, estimatedTotal: 0, quoteTotal: 0 };
  });

  return { columns, totals };
}

export { OPPORTUNITY_STAGES as PIPELINE_STAGES };
