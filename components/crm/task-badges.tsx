import { StatusBadge } from "@/components/status-badge";
import {
  formatTaskPriorityLabel,
  formatTaskStatusLabel,
} from "@/lib/crm/task-config";
import type { TaskPriority, TaskStatus } from "@/lib/crm/types";

type BadgeStatus =
  | "pending"
  | "approved"
  | "disabled"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

const taskStatusVariantMap: Record<TaskStatus, BadgeStatus> = {
  open: "pending",
  in_progress: "sent",
  completed: "accepted",
  cancelled: "disabled",
};

const taskPriorityVariantMap: Record<TaskPriority, BadgeStatus> = {
  low: "disabled",
  normal: "draft",
  high: "sent",
  urgent: "declined",
};

export function TaskStatusBadge({ status }: { status: TaskStatus | string }) {
  const normalized = status as TaskStatus;
  const variant = taskStatusVariantMap[normalized] ?? "pending";

  return (
    <StatusBadge
      status={variant}
      label={formatTaskStatusLabel(status)}
    />
  );
}

export function TaskPriorityBadge({
  priority,
}: {
  priority: TaskPriority | string;
}) {
  const normalized = priority as TaskPriority;
  const variant = taskPriorityVariantMap[normalized] ?? "draft";

  return (
    <StatusBadge
      status={variant}
      label={formatTaskPriorityLabel(priority)}
    />
  );
}
