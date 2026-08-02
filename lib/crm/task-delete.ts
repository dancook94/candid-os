import type { SupabaseClient } from "@supabase/supabase-js";

import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import {
  loadTaskAssigneeIds,
  loadTaskAssigneesByTaskIds,
} from "@/lib/crm/task-assignees";
import {
  isPermanentDeleteConfirmationValid,
  permanentDeleteConfirmationErrorMessage,
} from "@/lib/permanent-delete-confirmation";

export type PermanentDeleteTaskResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export function mapTaskDeleteError(message: string): {
  status: number;
  message: string;
} {
  if (message.includes("Task not found")) {
    return { status: 404, message: "Task not found." };
  }

  if (
    message.includes("Admin access required") ||
    message.includes("Authentication required") ||
    message.includes("insufficient_privilege")
  ) {
    return {
      status: 403,
      message: "You do not have permission to delete tasks.",
    };
  }

  if (
    message.includes("immutable") ||
    message.includes("cannot be updated or deleted")
  ) {
    return {
      status: 500,
      message:
        "Task deletion was rolled back because CRM activity cleanup is blocked.",
    };
  }

  if (message.includes("at_least_one_link") || message.includes("check_violation")) {
    return {
      status: 500,
      message: "Task deletion was rolled back because linked record cleanup failed.",
    };
  }

  return { status: 500, message };
}

export async function permanentlyDeleteTaskAsAdmin(
  supabase: SupabaseClient,
  {
    taskId,
    confirmationTitle,
    deletedBy,
    taskTitle,
    taskStatus,
    dueAt,
    assigneeProfileIds,
    companyId,
    opportunityId,
    quoteId,
  }: {
    taskId: string;
    confirmationTitle: string;
    deletedBy: string;
    taskTitle: string;
    taskStatus: string;
    dueAt: string | null;
    assigneeProfileIds: string[];
    companyId: string | null;
    opportunityId: string | null;
    quoteId: string | null;
  }
): Promise<PermanentDeleteTaskResult> {
  if (!isPermanentDeleteConfirmationValid(confirmationTitle)) {
    return {
      ok: false,
      status: 400,
      message: permanentDeleteConfirmationErrorMessage(),
    };
  }

  const deletedAt = new Date().toISOString();

  const { error: deleteError } = await supabase.rpc("permanently_delete_task", {
    p_task_id: taskId,
    p_deleted_by: deletedBy,
    p_description: `Task ${taskTitle.trim()} was permanently deleted.`,
    p_metadata: {
      deleted_task_id: taskId,
      task_title: taskTitle.trim(),
      previous_status: taskStatus,
      due_at: dueAt,
      assignee_profile_ids: assigneeProfileIds,
      deleted_by: deletedBy,
      deleted_at: deletedAt,
    },
  });

  if (deleteError) {
    const mapped = mapTaskDeleteError(deleteError.message);
    return { ok: false, status: mapped.status, message: mapped.message };
  }

  return { ok: true };
}

export type TaskDeleteContext = {
  taskId: string;
  title: string;
  status: string;
  dueAt: string | null;
  companyId: string | null;
  opportunityId: string | null;
  quoteId: string | null;
  opportunityTitle: string | null;
  quoteLabel: string | null;
  assigneeNames: string[];
  assigneeProfileIds: string[];
};

export async function loadTaskDeleteContext(
  supabase: SupabaseClient,
  taskId: string
): Promise<TaskDeleteContext | null> {
  const { data: task, error } = await supabase
    .from("tasks")
    .select(
      "id, title, status, due_at, company_id, opportunity_id, quote_id, assigned_to"
    )
    .eq("id", taskId)
    .maybeSingle();

  if (error || !task) {
    return null;
  }

  const [{ data: opportunity }, { data: quote }, assigneeProfileIds] =
    await Promise.all([
    task.opportunity_id
      ? supabase
          .from("opportunities")
          .select("title")
          .eq("id", task.opportunity_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    task.quote_id
      ? supabase
          .from("quotes")
          .select("quote_number, project_name")
          .eq("id", task.quote_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadTaskAssigneeIds(supabase, taskId),
  ]);

  const assigneeProfiles = await loadTaskAssigneesByTaskIds(supabase, [taskId]);
  const assigneeNames = (assigneeProfiles.get(taskId) ?? []).map((profile) =>
    getStaffDisplayName(profile)
  );

  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    dueAt: task.due_at,
    companyId: task.company_id,
    opportunityId: task.opportunity_id,
    quoteId: task.quote_id,
    opportunityTitle: opportunity?.title ?? null,
    quoteLabel: quote ? `Q-${quote.quote_number} · ${quote.project_name}` : null,
    assigneeNames,
    assigneeProfileIds,
  };
}
