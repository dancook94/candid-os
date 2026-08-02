import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { reconcileJobForAcceptedQuote } from "@/lib/jobs/create-from-quote";
import { revalidateQuoteWorkflowRoutes } from "@/lib/quote-route-revalidation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  const result = await reconcileJobForAcceptedQuote({
    quoteId: id,
    actorProfileId: authResult.userId,
  });

  if (!result.job && !result.schemaMissing) {
    return NextResponse.json(
      { error: result.warning ?? "Unable to create job for this quote." },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();
  const { data: quoteLink } = await adminClient
    .from("quotes")
    .select("quote_request_id, opportunity_id")
    .eq("id", id)
    .maybeSingle();

  revalidateQuoteWorkflowRoutes({
    quoteId: id,
    quoteRequestId: quoteLink?.quote_request_id ?? null,
    jobId: result.job?.id ?? null,
    opportunityId: quoteLink?.opportunity_id ?? null,
  });

  return NextResponse.json({
    success: true,
    jobId: result.job?.id ?? null,
    jobReference: result.job?.job_reference ?? null,
    created: result.created,
    jobWarning: result.warning,
    schemaMissing: result.schemaMissing,
  });
}
