import type { SupabaseClient } from "@supabase/supabase-js";

import { getCrmTimeline, type CrmTimelineItem } from "@/lib/crm/get-crm-timeline";
import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import { getLondonDayBounds } from "@/lib/crm/day-bounds";
import {
  loadTaskAssigneesByTaskIds,
  type TaskAssigneeProfile,
} from "@/lib/crm/task-assignees";
import { OPEN_TASK_STATUSES } from "@/lib/crm/task-config";
import type { OpportunityStage, TaskPriority, TaskStatus } from "@/lib/crm/types";

const TERMINAL_STAGE_FILTER = '("won","lost")';

export type AdminDashboardCrmMetrics = {
  activeOpportunitiesCount: number;
  activePipelineValue: number;
  needsFollowUpCount: number;
  myOpenTasksCount: number;
  overdueTasksCount: number;
  dueTodayTasksCount: number;
};

export type AdminDashboardRecentOpportunity = {
  id: string;
  title: string;
  company_name: string;
  stage: OpportunityStage;
  estimated_value: number | null;
  owner_name: string;
  updated_at: string;
  next_follow_up_at: string | null;
};

export type AdminDashboardAttentionTask = {
  id: string;
  title: string;
  opportunity_id: string | null;
  opportunity_title: string | null;
  due_at: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assignees: TaskAssigneeProfile[];
  isOverdue: boolean;
  isDueToday: boolean;
};

export type AdminDashboardRecentActivity = {
  id: string;
  description: string;
  actor_name: string | null;
  created_at: string;
  href: string;
  context_label: string | null;
};

export type AdminDashboardCrmData = {
  metrics: AdminDashboardCrmMetrics;
  recentOpportunities: AdminDashboardRecentOpportunity[];
  attentionTasks: AdminDashboardAttentionTask[];
  recentActivity: AdminDashboardRecentActivity[];
  errors: string[];
};

function parseEstimatedValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function countNeedsFollowUp(
  opportunities: { id: string; next_follow_up_at: string | null }[],
  opportunityIdsWithFutureTask: Set<string>,
  nowIso: string
) {
  return opportunities.filter((opportunity) => {
    const followUpOverdue =
      opportunity.next_follow_up_at !== null &&
      opportunity.next_follow_up_at < nowIso;
    const noFutureIncompleteTask = !opportunityIdsWithFutureTask.has(
      opportunity.id
    );

    return followUpOverdue || noFutureIncompleteTask;
  }).length;
}

function getAttentionSortKey(
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

async function countMyOpenTasks(
  supabase: SupabaseClient,
  userId: string,
  errors: string[]
) {
  const { data: assigneeRows, error: assigneeError } = await supabase
    .from("task_assignees")
    .select("task_id")
    .eq("profile_id", userId);

  if (assigneeError) {
    errors.push(`My open tasks (assignees): ${assigneeError.message}`);
  }

  const assigneeTaskIds = new Set(
    (assigneeRows ?? []).map((row) => row.task_id)
  );

  const { data: openTasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id, assigned_to")
    .in("status", OPEN_TASK_STATUSES);

  if (tasksError) {
    errors.push(`My open tasks: ${tasksError.message}`);
    return 0;
  }

  const matchingIds = new Set<string>();

  (openTasks ?? []).forEach((task) => {
    if (assigneeTaskIds.has(task.id) || task.assigned_to === userId) {
      matchingIds.add(task.id);
    }
  });

  return matchingIds.size;
}

function mapTimelineToDashboardActivity(
  items: CrmTimelineItem[]
): AdminDashboardRecentActivity[] {
  return items.slice(0, 10).map((item) => ({
    id: item.id,
    description: item.description,
    actor_name: item.actor_name,
    created_at: item.created_at,
    href: item.linked_record_href ?? "/admin",
    context_label: item.linked_record_label,
  }));
}

export async function fetchAdminDashboardCrm(
  supabase: SupabaseClient,
  userId: string
): Promise<AdminDashboardCrmData> {
  const errors: string[] = [];
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const { start: todayStartIso, end: todayEndIso } = getLondonDayBounds();
  const todayStartMs = new Date(todayStartIso).getTime();
  const todayEndMs = new Date(todayEndIso).getTime();

  const [
    { count: activeOpportunitiesCount, error: activeCountError },
    { data: activeOpportunityRows, error: activeRowsError },
    { data: activeOpportunitiesForFollowUp, error: followUpOppsError },
    { data: futureIncompleteTasks, error: futureTasksError },
    myOpenTasksCount,
    { count: overdueTasksCount, error: overdueError },
    { count: dueTodayTasksCount, error: dueTodayError },
    { data: recentOpportunityRows, error: recentOppsError },
    { data: openTaskRows, error: openTasksError },
  ] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .not("stage", "in", TERMINAL_STAGE_FILTER),
    supabase
      .from("opportunities")
      .select("estimated_value")
      .not("stage", "in", TERMINAL_STAGE_FILTER),
    supabase
      .from("opportunities")
      .select("id, next_follow_up_at")
      .not("stage", "in", TERMINAL_STAGE_FILTER),
    supabase
      .from("tasks")
      .select("opportunity_id")
      .in("status", OPEN_TASK_STATUSES)
      .not("opportunity_id", "is", null)
      .gt("due_at", nowIso),
    countMyOpenTasks(supabase, userId, errors),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .in("status", OPEN_TASK_STATUSES)
      .not("due_at", "is", null)
      .lt("due_at", nowIso),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .in("status", OPEN_TASK_STATUSES)
      .not("due_at", "is", null)
      .gte("due_at", todayStartIso)
      .lte("due_at", todayEndIso),
    supabase
      .from("opportunities")
      .select(
        "id, title, stage, estimated_value, owner_profile_id, updated_at, next_follow_up_at, company_id"
      )
      .not("stage", "in", TERMINAL_STAGE_FILTER)
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("tasks")
      .select(
        "id, title, opportunity_id, due_at, priority, status, assigned_to"
      )
      .in("status", OPEN_TASK_STATUSES),
  ]);

  if (activeCountError) {
    errors.push(`Active opportunities: ${activeCountError.message}`);
  }

  if (activeRowsError) {
    errors.push(`Active pipeline value: ${activeRowsError.message}`);
  }

  if (followUpOppsError) {
    errors.push(`Needs follow-up opportunities: ${followUpOppsError.message}`);
  }

  if (futureTasksError) {
    errors.push(`Future incomplete tasks: ${futureTasksError.message}`);
  }

  if (overdueError) {
    errors.push(`Overdue tasks: ${overdueError.message}`);
  }

  if (dueTodayError) {
    errors.push(`Due today tasks: ${dueTodayError.message}`);
  }

  if (recentOppsError) {
    errors.push(`Recent opportunities: ${recentOppsError.message}`);
  }

  if (openTasksError) {
    errors.push(`Tasks requiring attention: ${openTasksError.message}`);
  }

  const activePipelineValue = (activeOpportunityRows ?? []).reduce(
    (total, row) => {
      const value = parseEstimatedValue(row.estimated_value);
      return value === null ? total : total + value;
    },
    0
  );

  const opportunityIdsWithFutureTask = new Set(
    (futureIncompleteTasks ?? [])
      .map((task) => task.opportunity_id)
      .filter((value): value is string => Boolean(value))
  );

  const needsFollowUpCount =
    followUpOppsError || futureTasksError
      ? 0
      : countNeedsFollowUp(
          activeOpportunitiesForFollowUp ?? [],
          opportunityIdsWithFutureTask,
          nowIso
        );

  const recentRows = recentOpportunityRows ?? [];
  const companyIds = [
    ...new Set(recentRows.map((row) => row.company_id).filter(Boolean)),
  ];
  const ownerIds = [
    ...new Set(recentRows.map((row) => row.owner_profile_id).filter(Boolean)),
  ];

  const [{ data: companies }, { data: owners }] = await Promise.all([
    companyIds.length > 0
      ? supabase
          .from("companies")
          .select("id, company_name")
          .in("id", companyIds)
      : Promise.resolve({
          data: [] as { id: string; company_name: string }[],
        }),
    ownerIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", ownerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
  ]);

  const companyNameById = new Map(
    (companies ?? []).map((company) => [company.id, company.company_name])
  );
  const ownerNameById = new Map(
    (owners ?? []).map((owner) => [owner.id, getStaffDisplayName(owner)])
  );

  const recentOpportunities: AdminDashboardRecentOpportunity[] = recentRows.map(
    (row) => ({
      id: row.id,
      title: row.title,
      company_name: companyNameById.get(row.company_id) ?? "Unknown company",
      stage: row.stage as OpportunityStage,
      estimated_value: parseEstimatedValue(row.estimated_value),
      owner_name: ownerNameById.get(row.owner_profile_id) ?? "Unknown owner",
      updated_at: row.updated_at,
      next_follow_up_at: row.next_follow_up_at,
    })
  );

  const sortedOpenTasks = [...(openTaskRows ?? [])].sort((left, right) => {
    const leftKey = getAttentionSortKey(
      left.due_at,
      nowMs,
      todayStartMs,
      todayEndMs
    );
    const rightKey = getAttentionSortKey(
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

  const attentionTaskRows = sortedOpenTasks.slice(0, 8);
  const attentionTaskIds = attentionTaskRows.map((task) => task.id);
  const attentionOpportunityIds = [
    ...new Set(
      attentionTaskRows
        .map((task) => task.opportunity_id)
        .filter((value): value is string => Boolean(value))
    ),
  ];

  let recentActivityItems: CrmTimelineItem[] = [];

  try {
    const recentActivity = await getCrmTimeline(supabase, {
      scope: { type: "recent", limit: 10 },
    });
    recentActivityItems = recentActivity.items;
  } catch (error) {
    errors.push(
      `Recent CRM activity: ${
        error instanceof Error ? error.message : "Unable to load recent activity."
      }`
    );
  }

  const [assigneesByTaskId, { data: attentionOpportunities }] =
    await Promise.all([
      loadTaskAssigneesByTaskIds(supabase, attentionTaskIds),
      attentionOpportunityIds.length > 0
        ? supabase
            .from("opportunities")
            .select("id, title")
            .in("id", attentionOpportunityIds)
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    ]);

  const opportunityTitleById = new Map(
    (attentionOpportunities ?? []).map((opportunity) => [
      opportunity.id,
      opportunity.title,
    ])
  );

  const attentionTasks: AdminDashboardAttentionTask[] = attentionTaskRows.map(
    (task) => {
      const dueMs = task.due_at ? new Date(task.due_at).getTime() : null;

      return {
        id: task.id,
        title: task.title,
        opportunity_id: task.opportunity_id,
        opportunity_title: task.opportunity_id
          ? opportunityTitleById.get(task.opportunity_id) ?? null
          : null,
        due_at: task.due_at,
        priority: task.priority as TaskPriority,
        status: task.status as TaskStatus,
        assignees: assigneesByTaskId.get(task.id) ?? [],
        isOverdue: dueMs !== null && dueMs < nowMs,
        isDueToday:
          dueMs !== null && dueMs >= todayStartMs && dueMs <= todayEndMs,
      };
    }
  );

  return {
    metrics: {
      activeOpportunitiesCount: activeCountError ? 0 : (activeOpportunitiesCount ?? 0),
      activePipelineValue: activeRowsError ? 0 : activePipelineValue,
      needsFollowUpCount,
      myOpenTasksCount,
      overdueTasksCount: overdueError ? 0 : (overdueTasksCount ?? 0),
      dueTodayTasksCount: dueTodayError ? 0 : (dueTodayTasksCount ?? 0),
    },
    recentOpportunities,
    attentionTasks,
    recentActivity: mapTimelineToDashboardActivity(recentActivityItems),
    errors,
  };
}
