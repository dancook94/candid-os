import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { linkQuoteToOpportunity } from "@/lib/crm/link-quote-opportunity";
import { createClient } from "@/lib/supabase/server";

type LinkBody = {
  opportunityId?: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: quoteId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: LinkBody;

  try {
    body = (await request.json()) as LinkBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.opportunityId?.trim()) {
    return NextResponse.json(
      { error: "Opportunity is required." },
      { status: 400 }
    );
  }

  const result = await linkQuoteToOpportunity(supabase, {
    quoteId,
    opportunityId: body.opportunityId.trim(),
    linkedBy: auth.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  revalidatePath("/admin/quotes");
  revalidatePath(`/admin/quotes/${quoteId}`);
  revalidatePath(`/admin/opportunities/${result.opportunityId}`);

  return NextResponse.json({
    ok: true,
    opportunityId: result.opportunityId,
  });
}
