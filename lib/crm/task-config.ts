import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/crm/types";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const OPEN_TASK_STATUSES: TaskStatus[] = ["open", "in_progress"];

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function formatTaskStatusLabel(status: string) {
  if (isTaskStatus(status)) {
    return TASK_STATUS_LABELS[status];
  }

  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatTaskPriorityLabel(priority: string) {
  if (isTaskPriority(priority)) {
    return TASK_PRIORITY_LABELS[priority];
  }

  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

export function isOpenTaskStatus(status: TaskStatus) {
  return OPEN_TASK_STATUSES.includes(status);
}

export function getTaskStatusOptions() {
  return TASK_STATUSES.map((status) => ({
    value: status,
    label: TASK_STATUS_LABELS[status],
    isOpen: isOpenTaskStatus(status),
  }));
}

export function getTaskPriorityOptions() {
  return TASK_PRIORITIES.map((priority) => ({
    value: priority,
    label: TASK_PRIORITY_LABELS[priority],
  }));
}
