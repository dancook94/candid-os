import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { loadOpenQuoteFollowUpTasksForQuote } from "@/lib/crm/complete-quote-follow-up-tasks";
import { reconcileQuoteFollowUpTasks } from "@/lib/crm/reconcile-quote-follow-up-tasks";
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

  const adminClient = createAdminClient();
  const { data: quote, error: quoteError } = await adminClient
    .from("quotes")
    .select("id, status, quote_request_id, opportunity_id")
    .eq("id", id)
    .maybeSingle();

  if (quoteError) {
    return NextResponse.json({ error: quoteError.message }, { status: 500 });
  }

  if (!quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }

  if (quote.status !== "accepted") {
    return NextResponse.json(
      { error: "Only accepted quotes can reconcile follow-up tasks." },
      { status: 400 }
    );
  }

  const before = await loadOpenQuoteFollowUpTasksForQuote(adminClient, id);

  const result = await reconcileQuoteFollowUpTasks({
    quoteId: id,
    actorProfileId: authResult.userId,
    trigger: "accepted_quote_reconciliation",
  });

  revalidateQuoteWorkflowRoutes({
    quoteId: id,
    quoteRequestId: quote.quote_request_id ?? null,
    opportunityId: quote.opportunity_id ?? null,
    taskIds: result.completedTaskIds,
  });

  return NextResponse.json({
    success: result.errors.length === 0,
    completedFollowUpTaskIds: result.completedTaskIds,
    matchedTaskIds: result.matchedTaskIds,
    openTaskIdsBefore: before.openTasks.map((task) => task.id),
    errors: result.errors,
  });
}
