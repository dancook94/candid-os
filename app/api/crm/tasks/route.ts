import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { logOpportunityActivity } from "@/lib/crm/opportunity-stage-sync";
import { createTaskAssignees } from "@/lib/crm/task-assignees";
import {
  isTaskPriority,
  isTaskStatus,
} from "@/lib/crm/task-config";
import { validateCrmStaffProfileIds } from "@/lib/crm/validate-crm-staff-ids";
import type { TaskPriority, TaskStatus } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";

type CreateTaskBody = {
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: CreateTaskBody;

  try {
    body = (await request.json()) as CreateTaskBody;
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

  const staffValidation = await validateCrmStaffProfileIds(
    supabase,
    assigneeProfileIds
  );

  if (!staffValidation.ok) {
    return NextResponse.json({ error: staffValidation.message }, { status: 400 });
  }

  const priority: TaskPriority = isTaskPriority(body.priority ?? "")
    ? (body.priority as TaskPriority)
    : "normal";
  const status: TaskStatus = isTaskStatus(body.status ?? "")
    ? (body.status as TaskStatus)
    : "open";

  const { data: created, error: insertError } = await supabase
    .from("tasks")
    .insert({
      title,
      description: body.description?.trim() || null,
      assigned_to: assigneeProfileIds[0],
      created_by: auth.userId,
      due_at: parseDateTimeValue(body.dueAt),
      priority,
      status,
      opportunity_id: body.opportunityId || null,
      quote_id: body.quoteId || null,
      company_id: body.companyId || null,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .select("id, opportunity_id")
    .single();

  if (insertError || !created) {
    return NextResponse.json(
      { error: insertError?.message ?? "Unable to create task." },
      { status: 400 }
    );
  }

  const assigneeResult = await createTaskAssignees(supabase, {
    taskId: created.id,
    assigneeProfileIds,
    assignedBy: auth.userId,
  });

  if (!assigneeResult.ok) {
    await supabase.from("tasks").delete().eq("id", created.id);
    return NextResponse.json({ error: assigneeResult.message }, { status: 400 });
  }

  if (created.opportunity_id) {
    await logOpportunityActivity(supabase, {
      opportunityId: created.opportunity_id,
      companyId: body.companyId || null,
      quoteId: body.quoteId || null,
      taskId: created.id,
      activityType: CRM_ACTIVITY_TYPES.taskCreated,
      description: `Task "${title}" created.`,
      metadata: { task_id: created.id },
      createdBy: auth.userId,
    });
  } else {
    await logOpportunityActivity(supabase, {
      companyId: body.companyId || null,
      taskId: created.id,
      activityType: CRM_ACTIVITY_TYPES.taskCreated,
      description: `Task "${title}" created.`,
      metadata: { task_id: created.id },
      createdBy: auth.userId,
    });
  }

  revalidatePath("/admin/tasks");
  if (created.opportunity_id) {
    revalidatePath(`/admin/opportunities/${created.opportunity_id}`);
  }

  return NextResponse.json({ ok: true, taskId: created.id });
}
