import { NextResponse } from "next/server";

import { respondToQuoteAsAdmin } from "@/lib/admin-quote-actions";
import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { revalidateQuoteWorkflowRoutes } from "@/lib/quote-route-revalidation";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function revalidateQuotePaths(supabase: Awaited<ReturnType<typeof createClient>>, quoteId: string) {
  const { data: quoteLink } = await supabase
    .from("quotes")
    .select("quote_request_id")
    .eq("id", quoteId)
    .maybeSingle();

  revalidateQuoteWorkflowRoutes({
    quoteId,
    quoteRequestId: quoteLink?.quote_request_id ?? null,
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

  revalidateQuotePaths(supabase, id);

  return NextResponse.json({ success: true });
}

export async function POST(_request: Request, context: RouteContext) {
  return handleAdminQuoteResponse(context, "accept");
}
