import { NextResponse } from "next/server";

import { respondToQuoteAsAdmin } from "@/lib/admin-quote-actions";
import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { revalidateQuoteWorkflowRoutes } from "@/lib/quote-route-revalidation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function revalidateQuotePaths(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quoteId: string,
  jobId?: string | null
) {
  const adminClient = createAdminClient();
  const { data: quoteLink } = await adminClient
    .from("quotes")
    .select("quote_request_id, opportunity_id")
    .eq("id", quoteId)
    .maybeSingle();

  revalidateQuoteWorkflowRoutes({
    quoteId,
    quoteRequestId: quoteLink?.quote_request_id ?? null,
    jobId: jobId ?? null,
    opportunityId: quoteLink?.opportunity_id ?? null,
  });
}

async function handleAdminQuoteResponse(
  context: RouteContext,
  action: "accept" | "decline"
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  const result = await respondToQuoteAsAdmin(supabase, {
    quoteId: id,
    action,
    changedBy: authResult.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  await revalidateQuotePaths(supabase, id, result.job?.jobId ?? null);

  return NextResponse.json({
    success: true,
    jobId: result.job?.jobId ?? null,
    jobReference: result.job?.jobReference ?? null,
    jobWarning: result.job?.jobWarning ?? null,
    schemaMissing: result.job?.schemaMissing ?? false,
  });
}

export async function POST(_request: Request, context: RouteContext) {
  return handleAdminQuoteResponse(context, "accept");
}
