import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { updateOpportunityContact } from "@/lib/crm/opportunity-contact";
import { createClient } from "@/lib/supabase/server";

type ContactBody = {
  contactId?: string;
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

  let body: ContactBody;

  try {
    body = (await request.json()) as ContactBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.contactId?.trim()) {
    return NextResponse.json({ error: "Contact is required." }, { status: 400 });
  }

  const { data: opportunity, error: opportunityError } = await supabase
    .from("opportunities")
    .select("company_id")
    .eq("id", opportunityId)
    .maybeSingle();

  if (opportunityError || !opportunity) {
    return NextResponse.json(
      { error: opportunityError?.message ?? "Opportunity not found." },
      { status: 404 }
    );
  }

  try {
    await updateOpportunityContact(supabase, {
      opportunityId,
      contactId: body.contactId.trim(),
      companyId: opportunity.company_id,
      updatedBy: auth.userId,
    });

    revalidatePath("/admin/opportunities");
    revalidatePath(`/admin/opportunities/${opportunityId}`);
    revalidatePath(`/admin/opportunities/${opportunityId}/edit`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update opportunity contact.",
      },
      { status: 400 }
    );
  }
}
