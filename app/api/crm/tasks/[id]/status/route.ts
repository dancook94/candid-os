import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { logOpportunityActivity } from "@/lib/crm/opportunity-stage-sync";
import { canAccessTask } from "@/lib/crm/task-access";
import { loadTaskAssigneeIds } from "@/lib/crm/task-assignees";
import type { TaskStatus } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";

type StatusBody = {
  status?: TaskStatus;
};

export async function POST(
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

  const assigneeIds = await loadTaskAssigneeIds(supabase, taskId);
  const isAssignee = assigneeIds.includes(auth.userId);

  if (
    !isAssignee &&
    !["super_admin", "admin"].includes(auth.userRole)
  ) {
    const { data: task } = await supabase
      .from("tasks")
      .select("created_by, opportunity_id")
      .eq("id", taskId)
      .maybeSingle();

    const isCreator = task?.created_by === auth.userId;
    const canViaOpportunity = Boolean(task?.opportunity_id);

    if (!isCreator && !canViaOpportunity) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  let body: StatusBody;

  try {
    body = (await request.json()) as StatusBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const nextStatus = body.status;

  if (nextStatus !== "completed" && nextStatus !== "open") {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("tasks")
    .select("title, status, opportunity_id, company_id, quote_id")
    .eq("id", taskId)
    .maybeSingle();

  if (existingError || !existing) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  if (existing.status === nextStatus) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const completedAt =
    nextStatus === "completed" ? new Date().toISOString() : null;

  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      status: nextStatus,
      completed_at: completedAt,
    })
    .eq("id", taskId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const activityType =
    nextStatus === "completed"
      ? CRM_ACTIVITY_TYPES.taskCompleted
      : CRM_ACTIVITY_TYPES.taskReopened;
  const description =
    nextStatus === "completed"
      ? `Task "${existing.title}" completed.`
      : `Task "${existing.title}" reopened.`;

  await logOpportunityActivity(supabase, {
    opportunityId: existing.opportunity_id,
    companyId: existing.company_id,
    quoteId: existing.quote_id,
    taskId,
    activityType,
    description,
    metadata: { task_id: taskId },
    createdBy: auth.userId,
  });

  revalidatePath("/admin/tasks");
  revalidatePath(`/admin/tasks/${taskId}/edit`);
  if (existing.opportunity_id) {
    revalidatePath(`/admin/opportunities/${existing.opportunity_id}`);
  }

  return NextResponse.json({ ok: true });
}
