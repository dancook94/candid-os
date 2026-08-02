import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { logOpportunityActivity } from "@/lib/crm/opportunity-stage-sync";
import { syncTaskAssignees } from "@/lib/crm/task-assignees";
import { canAccessTask } from "@/lib/crm/task-access";
import {
  isTaskPriority,
  isTaskStatus,
} from "@/lib/crm/task-config";
import type { TaskPriority, TaskStatus } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";

type UpdateTaskBody = {
  title?: string;
  description?: string | null;
  assigneeProfileIds?: string[];
  dueAt?: string | null;
  priority?: string;
  status?: string;
  opportunityId?: string | null;
  quoteId?: string | null;
  companyId?: string | null;
};

function parseDateTimeValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const hasAccess = await canAccessTask(
    supabase,
    taskId,
    auth.userId,
    auth.userRole
  );

  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: UpdateTaskBody;

  try {
    body = (await request.json()) as UpdateTaskBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = body.title?.trim();

  if (!title) {
    return NextResponse.json({ error: "Task title is required." }, { status: 400 });
  }

  const assigneeProfileIds = [...new Set(body.assigneeProfileIds ?? [])];

  if (assigneeProfileIds.length === 0) {
    return NextResponse.json(
      { error: "At least one assignee is required." },
      { status: 400 }
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("tasks")
    .select("title, status, opportunity_id, company_id, quote_id")
    .eq("id", taskId)
    .maybeSingle();

  if (existingError || !existing) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const priority: TaskPriority = isTaskPriority(body.priority ?? "")
    ? (body.priority as TaskPriority)
    : "normal";
  const status: TaskStatus = isTaskStatus(body.status ?? "")
    ? (body.status as TaskStatus)
    : "open";

  const targetOpportunityId = body.opportunityId ?? existing.opportunity_id;

  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      title,
      description: body.description?.trim() || null,
      due_at: parseDateTimeValue(body.dueAt),
      priority,
      status,
      opportunity_id: body.opportunityId || null,
      quote_id: body.quoteId || null,
      company_id: body.companyId || null,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", taskId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const assigneeResult = await syncTaskAssignees(supabase, {
    taskId,
    assigneeProfileIds,
    assignedBy: auth.userId,
    opportunityId: targetOpportunityId,
    taskTitle: title,
  });

  if (!assigneeResult.ok) {
    return NextResponse.json({ error: assigneeResult.message }, { status: 400 });
  }

  const statusChanged = existing.status !== status;

  if (statusChanged && status === "completed") {
    await logOpportunityActivity(supabase, {
      opportunityId: targetOpportunityId,
      companyId: body.companyId ?? existing.company_id ?? null,
      quoteId: body.quoteId ?? existing.quote_id ?? null,
      taskId,
      activityType: CRM_ACTIVITY_TYPES.taskCompleted,
      description: `Task "${title}" completed.`,
      metadata: { task_id: taskId },
      createdBy: auth.userId,
    });
  } else if (statusChanged && status === "cancelled") {
    await logOpportunityActivity(supabase, {
      opportunityId: targetOpportunityId,
      companyId: body.companyId ?? existing.company_id ?? null,
      quoteId: body.quoteId ?? existing.quote_id ?? null,
      taskId,
      activityType: CRM_ACTIVITY_TYPES.taskCancelled,
      description: `Task "${title}" cancelled.`,
      metadata: { task_id: taskId },
      createdBy: auth.userId,
    });
  } else if (statusChanged && existing.status === "completed") {
    await logOpportunityActivity(supabase, {
      opportunityId: targetOpportunityId,
      companyId: body.companyId ?? existing.company_id ?? null,
      quoteId: body.quoteId ?? existing.quote_id ?? null,
      taskId,
      activityType: CRM_ACTIVITY_TYPES.taskReopened,
      description: `Task "${title}" reopened.`,
      metadata: { task_id: taskId },
      createdBy: auth.userId,
    });
  } else if (!statusChanged) {
    await logOpportunityActivity(supabase, {
      opportunityId: targetOpportunityId,
      companyId: body.companyId ?? existing.company_id ?? null,
      quoteId: body.quoteId ?? existing.quote_id ?? null,
      taskId,
      activityType: CRM_ACTIVITY_TYPES.taskUpdated,
      description: `Task "${title}" updated.`,
      metadata: { task_id: taskId },
      createdBy: auth.userId,
    });
  }

  revalidatePath("/admin/tasks");
  revalidatePath(`/admin/tasks/${taskId}/edit`);
  if (targetOpportunityId) {
    revalidatePath(`/admin/opportunities/${targetOpportunityId}`);
  }

  return NextResponse.json({ ok: true, taskId });
}
