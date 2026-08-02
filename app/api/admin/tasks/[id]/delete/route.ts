import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import {
  loadTaskDeleteContext,
  permanentlyDeleteTaskAsAdmin,
} from "@/lib/crm/task-delete";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type DeleteTaskBody = {
  confirmationTitle?: string;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const authResult = await verifyApprovedCrmAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: DeleteTaskBody;

  try {
    body = (await request.json()) as DeleteTaskBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const confirmationTitle = body.confirmationTitle?.trim() ?? "";

  if (!confirmationTitle) {
    return NextResponse.json(
      { error: "Confirmation text is required." },
      { status: 400 }
    );
  }

  const taskContext = await loadTaskDeleteContext(supabase, id);

  if (!taskContext) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const result = await permanentlyDeleteTaskAsAdmin(supabase, {
    taskId: id,
    confirmationTitle,
    deletedBy: authResult.userId,
    taskTitle: taskContext.title,
    taskStatus: taskContext.status,
    dueAt: taskContext.dueAt,
    assigneeProfileIds: taskContext.assigneeProfileIds,
    companyId: taskContext.companyId,
    opportunityId: taskContext.opportunityId,
    quoteId: taskContext.quoteId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/activity");

  if (taskContext.companyId) {
    revalidatePath(`/admin/companies/${taskContext.companyId}`);
  }

  if (taskContext.opportunityId) {
    revalidatePath(`/admin/opportunities/${taskContext.opportunityId}`);
    revalidatePath(`/admin/opportunities/${taskContext.opportunityId}/edit`);
  }

  return NextResponse.json({ success: true });
}
