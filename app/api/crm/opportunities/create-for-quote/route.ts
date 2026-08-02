import { NextResponse } from "next/server";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { createOpportunityForQuote } from "@/lib/crm/opportunity-linking";
import { createClient } from "@/lib/supabase/server";

type CreateBody = {
  companyId?: string;
  title?: string;
  description?: string | null;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: CreateBody;

  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.companyId?.trim() || !body.title?.trim()) {
    return NextResponse.json(
      { error: "Company and title are required." },
      { status: 400 }
    );
  }

  try {
    const opportunityId = await createOpportunityForQuote(supabase, {
      companyId: body.companyId,
      title: body.title.trim(),
      description: body.description,
      createdBy: auth.userId,
    });

    return NextResponse.json({ ok: true, opportunityId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create opportunity.",
      },
      { status: 400 }
    );
  }
}
