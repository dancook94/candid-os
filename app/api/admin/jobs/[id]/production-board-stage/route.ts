import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import {
  applyJobProductionBoardStageChange,
  isValidJobProductionBoardStage,
} from "@/lib/production/job-board-service";
import { reconcileJobCommercialCloseout } from "@/lib/production/job-commercial-closeout";
import type { JobProductionBoardStage } from "@/lib/production/job-board-constants";
import { ProductionError } from "@/lib/production/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type StageChangeBody = {
  stage?: string;
  previousStage?: string;
  reason?: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: StageChangeBody;

  try {
    body = (await request.json()) as StageChangeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const newStage = body.stage;

  if (!newStage || !isValidJobProductionBoardStage(newStage)) {
    return NextResponse.json({ error: "Invalid stage." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    const result = await applyJobProductionBoardStageChange(
      adminClient,
      jobId,
      newStage as JobProductionBoardStage,
      auth.userId,
      body.reason
    );

    revalidatePath("/admin/production");
    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath(`/admin/jobs/${jobId}/invoice`);

    let commercialCloseout = null;

    if (newStage === "complete_job") {
      commercialCloseout = await reconcileJobCommercialCloseout(
        adminClient,
        jobId,
        auth.userId
      );
    }

    return NextResponse.json({ ...result, commercialCloseout });
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to update production board stage." },
      { status: 500 }
    );
  }
}
