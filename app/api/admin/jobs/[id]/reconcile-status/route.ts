import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { reconcileAwaitingArtworkJobStatuses } from "@/lib/jobs/reconcile-awaiting-artwork-jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
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
    const result = await reconcileAwaitingArtworkJobStatuses(adminClient, {
      jobId: id,
      actorProfileId: authResult.userId,
      trigger: "admin_job_status_reconciliation",
    });

    return NextResponse.json({
      success: result.errors.length === 0,
      updatedJobIds: result.updatedJobIds,
      skippedJobIds: result.skippedJobIds,
      errors: result.errors,
    });
  } catch (error) {
    return jobErrorResponse(error);
  }
}
