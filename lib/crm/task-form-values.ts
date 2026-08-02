import { toDateTimeLocalValue } from "@/lib/crm/format-datetime";
import type { TaskPriority, TaskStatus } from "@/lib/crm/types";

export type TaskFormInitialValues = {
  title: string;
  description: string;
  assigneeProfileIds: string[];
  dueAt: string;
  priority: TaskPriority;
  status: TaskStatus;
  opportunityId: string;
  quoteId: string;
  companyId: string;
};

export function buildTaskFormInitialValues(
  task: {
    title: string;
    description: string | null;
    assigned_to: string;
    due_at: string | null;
    priority: TaskPriority;
    status: TaskStatus;
    opportunity_id: string | null;
    quote_id: string | null;
    company_id: string | null;
  },
  assigneeProfileIds?: string[]
): TaskFormInitialValues {
  return {
    title: task.title,
    description: task.description ?? "",
    assigneeProfileIds:
      assigneeProfileIds && assigneeProfileIds.length > 0
        ? assigneeProfileIds
        : [task.assigned_to],
    dueAt: toDateTimeLocalValue(task.due_at),
    priority: task.priority,
    status: task.status,
    opportunityId: task.opportunity_id ?? "",
    quoteId: task.quote_id ?? "",
    companyId: task.company_id ?? "",
  };
}
