import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import { permanentlyDeleteOpportunityAsAdmin } from "@/lib/crm/opportunity-delete";
import { permanentDeleteConfirmationErrorMessage } from "@/lib/permanent-delete-confirmation";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type DeleteOpportunityBody = {
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

  let body: DeleteOpportunityBody;

  try {
    body = (await request.json()) as DeleteOpportunityBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const confirmationTitle = body.confirmationTitle?.trim() ?? "";

  if (!confirmationTitle) {
    return NextResponse.json(
      { error: permanentDeleteConfirmationErrorMessage() },
      { status: 400 }
    );
  }

  const { data: opportunity, error: opportunityError } = await supabase
    .from("opportunities")
    .select("id, title, company_id")
    .eq("id", id)
    .maybeSingle();

  if (opportunityError) {
    return NextResponse.json(
      { error: opportunityError.message },
      { status: 500 }
    );
  }

  if (!opportunity) {
    return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  }

  const result = await permanentlyDeleteOpportunityAsAdmin(supabase, {
    opportunityId: id,
    confirmationTitle,
    deletedBy: authResult.userId,
    opportunityTitle: opportunity.title,
    companyId: opportunity.company_id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/opportunities");
  revalidatePath("/admin/activity");
  revalidatePath(`/admin/companies/${opportunity.company_id}`);

  return NextResponse.json({ success: true });
}
