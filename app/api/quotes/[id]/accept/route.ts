import { NextResponse } from "next/server";

import { respondToCustomerQuote } from "@/lib/customer-quote-response";
import { revalidateQuoteWorkflowRoutes } from "@/lib/quote-route-revalidation";
import { resolveQuoteRequestIdFromQuote } from "@/lib/quote-request-link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function handleQuoteResponse(
  request: Request,
  context: RouteContext,
  action: "accept" | "decline"
) {
  const { id } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await respondToCustomerQuote(supabase, {
    userId: user.id,
    quoteId: id,
    action,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  const quoteRequestId = await resolveQuoteRequestIdFromQuote(supabase, id);

  let opportunityId: string | null = null;

  if (action === "accept") {
    const adminClient = createAdminClient();
    const { data: quote } = await adminClient
      .from("quotes")
      .select("opportunity_id")
      .eq("id", id)
      .maybeSingle();

    opportunityId = quote?.opportunity_id ?? null;
  }

  revalidateQuoteWorkflowRoutes({
    quoteId: id,
    quoteRequestId,
    jobId: result.job?.jobId ?? null,
    opportunityId,
  });

  return NextResponse.json({
    success: true,
    jobId: result.job?.jobId ?? null,
    jobReference: result.job?.jobReference ?? null,
    jobWarning: result.job?.jobWarning ?? null,
    schemaMissing: result.job?.schemaMissing ?? false,
  });
}

export async function POST(_request: Request, context: RouteContext) {
  return handleQuoteResponse(_request, context, "accept");
}
