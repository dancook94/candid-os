import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { updateOpportunityAssignments } from "@/lib/crm/opportunity-assignments";
import { createClient } from "@/lib/supabase/server";

type AssignmentsBody = {
  ownerProfileId?: string;
  collaboratorProfileIds?: string[];
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: opportunityId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: AssignmentsBody;

  try {
    body = (await request.json()) as AssignmentsBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.ownerProfileId?.trim()) {
    return NextResponse.json({ error: "Owner is required." }, { status: 400 });
  }

  const result = await updateOpportunityAssignments(supabase, {
    opportunityId,
    ownerProfileId: body.ownerProfileId.trim(),
    collaboratorProfileIds: body.collaboratorProfileIds ?? [],
    updatedBy: auth.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  revalidatePath("/admin/opportunities");
  revalidatePath(`/admin/opportunities/${opportunityId}`);
  revalidatePath(`/admin/opportunities/${opportunityId}/edit`);

  return NextResponse.json({ ok: true });
}
