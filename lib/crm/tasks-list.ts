import type { SupabaseClient } from "@supabase/supabase-js";

import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import {
  loadTaskAssigneesByTaskIds,
  loadTaskIdsForAssignee,
  type TaskAssigneeProfile,
} from "@/lib/crm/task-assignees";
import {
  isTaskPriority,
  isTaskStatus,
  OPEN_TASK_STATUSES,
} from "@/lib/crm/task-config";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/crm/types";

export const TASK_LIST_VIEW_OPTIONS = [
  "my",
  "today",
  "overdue",
  "upcoming",
  "completed",
  "all",
] as const;

export type TaskListView = (typeof TASK_LIST_VIEW_OPTIONS)[number];

export type TasksListSearchParams = {
  view?: string;
  search?: string;
  assignee?: string;
  status?: string;
  priority?: string;
  due?: string;
  company?: string;
  opportunity?: string;
};

export type TasksListFilters = {
  view: TaskListView;
  search: string;
  assigneeId: string | null;
  status: TaskStatus | null;
  priority: TaskPriority | null;
  dueDate: string | null;
  companyId: string | null;
  opportunityId: string | null;
};

export type TaskListRow = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  assignee_name: string;
  assignees: TaskAssigneeProfile[];
  due_at: string | null;
  completed_at: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  opportunity_id: string | null;
  opportunity_title: string | null;
  company_id: string | null;
  company_name: string | null;
  quote_id: string | null;
  updated_at: string;
  created_at: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseViewParam(value: string | undefined): TaskListView {
  if (
    value &&
    (TASK_LIST_VIEW_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as TaskListView;
  }

  return "my";
}

function parseStatusParam(value: string | undefined): TaskStatus | null {
  if (!value) {
    return null;
  }

  return isTaskStatus(value) ? value : null;
}

function parsePriorityParam(value: string | undefined): TaskPriority | null {
  if (!value) {
    return null;
  }

  return isTaskPriority(value) ? value : null;
}

function parseDueDateParam(value: string | undefined) {
  if (!value || !DATE_PATTERN.test(value)) {
    return null;
  }

  return value;
}

export function parseTasksListFilters(
  params: TasksListSearchParams
): TasksListFilters {
  return {
    view: parseViewParam(params.view),
    search: params.search?.trim() ?? "",
    assigneeId: params.assignee?.trim() || null,
    status: parseStatusParam(params.status),
    priority: parsePriorityParam(params.priority),
    dueDate: parseDueDateParam(params.due),
    companyId: params.company?.trim() || null,
    opportunityId: params.opportunity?.trim() || null,
  };
}

export function hasActiveTasksListFilters(filters: TasksListFilters) {
  return Boolean(
    filters.search ||
      filters.assigneeId ||
      filters.status ||
      filters.priority ||
      filters.dueDate ||
      filters.companyId ||
      filters.opportunityId ||
      filters.view !== "my"
  );
}

export function buildTasksListHref(
  filters: TasksListFilters,
  overrides: Partial<TasksListFilters> = {}
) {
  const nextFilters = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (nextFilters.view !== "my") {
    params.set("view", nextFilters.view);
  }

  if (nextFilters.search) {
    params.set("search", nextFilters.search);
  }

  if (nextFilters.assigneeId) {
    params.set("assignee", nextFilters.assigneeId);
  }

  if (nextFilters.status) {
    params.set("status", nextFilters.status);
  }

  if (nextFilters.priority) {
    params.set("priority", nextFilters.priority);
  }

  if (nextFilters.dueDate) {
    params.set("due", nextFilters.dueDate);
  }

  if (nextFilters.companyId) {
    params.set("company", nextFilters.companyId);
  }

  if (nextFilters.opportunityId) {
    params.set("opportunity", nextFilters.opportunityId);
  }

  const query = params.toString();

  return query ? `/admin/tasks?${query}` : "/admin/tasks";
}

function sanitizeIlikeTerm(value: string) {
  return value.replace(/[%_,]/g, " ").trim();
}

function startOfDayIso(date: string) {
  return `${date}T00:00:00.000Z`;
}

function endOfDayIso(date: string) {
  return `${date}T23:59:59.999Z`;
}

type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  due_at: string | null;
  completed_at: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  opportunity_id: string | null;
  company_id: string | null;
  quote_id: string | null;
  created_at: string;
  updated_at: string;
};

function applyViewFilter(
  records: TaskRecord[],
  view: TaskListView,
  currentUserId: string,
  assigneesByTaskId: Map<string, TaskAssigneeProfile[]>
) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  switch (view) {
    case "my":
      return records.filter((record) => {
        const assignees = assigneesByTaskId.get(record.id) ?? [];

        if (assignees.some((assignee) => assignee.id === currentUserId)) {
          return true;
        }

        return record.assigned_to === currentUserId;
      });
    case "today":
      return records.filter((record) => {
        if (!record.due_at || !OPEN_TASK_STATUSES.includes(record.status)) {
          return false;
        }

        const due = new Date(record.due_at);
        return due >= todayStart && due <= todayEnd;
      });
    case "overdue":
      return records.filter((record) => {
        if (!record.due_at || !OPEN_TASK_STATUSES.includes(record.status)) {
          return false;
        }

        return new Date(record.due_at) < todayStart;
      });
    case "upcoming":
      return records.filter((record) => {
        if (!record.due_at || !OPEN_TASK_STATUSES.includes(record.status)) {
          return false;
        }

        return new Date(record.due_at) > todayEnd;
      });
    case "completed":
      return records.filter((record) => record.status === "completed");
    case "all":
    default:
      return records;
  }
}

export async function fetchTasksList(
  supabase: SupabaseClient,
  filters: TasksListFilters,
  currentUserId: string
) {
  let query = supabase.from("tasks").select("*");

  if (filters.assigneeId) {
    const taskIdsForAssignee = await loadTaskIdsForAssignee(
      supabase,
      filters.assigneeId
    );

    if (taskIdsForAssignee && taskIdsForAssignee.length > 0) {
      query = query.in("id", taskIdsForAssignee);
    } else {
      query = query.eq("assigned_to", filters.assigneeId);
    }
  }

  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  if (filters.priority) {
    query = query.eq("priority", filters.priority);
  }

  if (filters.dueDate) {
    query = query
      .gte("due_at", startOfDayIso(filters.dueDate))
      .lte("due_at", endOfDayIso(filters.dueDate));
  }

  if (filters.companyId) {
    query = query.eq("company_id", filters.companyId);
  }

  if (filters.opportunityId) {
    query = query.eq("opportunity_id", filters.opportunityId);
  }

  if (filters.search) {
    const sanitized = sanitizeIlikeTerm(filters.search);

    if (sanitized) {
      query = query.or(
        `title.ilike.%${sanitized}%,description.ilike.%${sanitized}%`
      );
    }
  }

  const { data: taskRows, error: tasksError } = await query.order("due_at", {
    ascending: true,
    nullsFirst: false,
  });

  if (tasksError) {
    return {
      tasks: [] as TaskListRow[],
      totalCount: 0,
      queryError: tasksError.message,
    };
  }

  let records = (taskRows ?? []) as TaskRecord[];
  const taskIds = records.map((record) => record.id);
  const assigneesByTaskId = await loadTaskAssigneesByTaskIds(supabase, taskIds);

  records = applyViewFilter(
    records,
    filters.view,
    currentUserId,
    assigneesByTaskId
  );

  if (records.length === 0) {
    return {
      tasks: [] as TaskListRow[],
      totalCount: 0,
      queryError: null,
    };
  }

  const opportunityIds = [
    ...new Set(
      records
        .map((record) => record.opportunity_id)
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const companyIds = [
    ...new Set(
      records
        .map((record) => record.company_id)
        .filter((value): value is string => Boolean(value))
    ),
  ];

  const [{ data: opportunities }, { data: companies }] = await Promise.all([
    opportunityIds.length > 0
      ? supabase
          .from("opportunities")
          .select("id, title")
          .in("id", opportunityIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    companyIds.length > 0
      ? supabase
          .from("companies")
          .select("id, company_name")
          .in("id", companyIds)
      : Promise.resolve({ data: [] as { id: string; company_name: string }[] }),
  ]);

  const opportunityTitleById = new Map(
    (opportunities ?? []).map((opportunity) => [
      opportunity.id,
      opportunity.title,
    ])
  );
  const companyNameById = new Map(
    (companies ?? []).map((company) => [company.id, company.company_name])
  );

  const tasks: TaskListRow[] = records.map((record) => {
    const assignees = assigneesByTaskId.get(record.id) ?? [];
    const primaryAssignee = assignees[0];

    return {
      id: record.id,
      title: record.title,
      description: record.description,
      assigned_to: record.assigned_to,
      assignee_name: primaryAssignee
        ? getStaffDisplayName(primaryAssignee)
        : "Unnamed staff member",
      assignees,
      due_at: record.due_at,
      completed_at: record.completed_at,
      status: record.status,
      priority: record.priority,
      opportunity_id: record.opportunity_id,
      opportunity_title: record.opportunity_id
        ? opportunityTitleById.get(record.opportunity_id) ?? null
        : null,
      company_id: record.company_id,
      company_name: record.company_id
        ? companyNameById.get(record.company_id) ?? null
        : null,
      quote_id: record.quote_id,
      updated_at: record.updated_at,
      created_at: record.created_at,
    };
  });

  return {
    tasks,
    totalCount: tasks.length,
    queryError: null,
  };
}

export function formatTaskListViewLabel(view: TaskListView) {
  switch (view) {
    case "my":
      return "My tasks";
    case "today":
      return "Today";
    case "overdue":
      return "Overdue";
    case "upcoming":
      return "Upcoming";
    case "completed":
      return "Completed";
    case "all":
      return "All team tasks";
    default:
      return view;
  }
}

export { TASK_STATUSES, TASK_PRIORITIES };
