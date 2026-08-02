import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { reconcileQuoteFollowUpTasks } from "@/lib/crm/reconcile-quote-follow-up-tasks";
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

  if (result.schemaMissing) {
    return NextResponse.json(
      {
        error:
          result.warning ??
          "Production jobs table is not deployed. Apply supabase/migrations/20260802190000_jobs_foundation.sql in Supabase first.",
        schemaMissing: true,
      },
      { status: 503 }
    );
  }

  if (!result.job) {
    return NextResponse.json(
      { error: result.warning ?? "Unable to create job for this quote." },
      { status: 400 }
    );
  }

  const taskResult = await reconcileQuoteFollowUpTasks({
    quoteId: id,
    actorProfileId: authResult.userId,
    trigger: "accepted_quote_reconciliation",
  });

  const adminClient = createAdminClient();
  const { data: quoteLink } = await adminClient
    .from("quotes")
    .select("quote_request_id, opportunity_id")
    .eq("id", id)
    .maybeSingle();

  revalidateQuoteWorkflowRoutes({
    quoteId: id,
    quoteRequestId: quoteLink?.quote_request_id ?? null,
    jobId: result.job.id,
    opportunityId: quoteLink?.opportunity_id ?? null,
    taskIds: taskResult.completedTaskIds,
  });

  return NextResponse.json({
    success: true,
    jobId: result.job.id,
    jobReference: result.job.job_reference,
    created: result.created,
    jobWarning: result.warning,
    schemaMissing: false,
    completedFollowUpTaskIds: taskResult.completedTaskIds,
  });
}
