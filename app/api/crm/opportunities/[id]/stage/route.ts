import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { isOpportunityStage } from "@/lib/crm/opportunity-stages";
import { applyManualOpportunityStageChange } from "@/lib/crm/opportunity-stage-sync";
import type { OpportunityStage } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";

type StageChangeBody = {
  stage?: string;
  previousStage?: string;
  lostReason?: string | null;
  confirmed?: boolean;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: opportunityId } = await context.params;
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
  const previousStage = body.previousStage;

  if (!newStage || !isOpportunityStage(newStage)) {
    return NextResponse.json({ error: "Invalid stage." }, { status: 400 });
  }

  if (!previousStage || !isOpportunityStage(previousStage)) {
    return NextResponse.json({ error: "Invalid previous stage." }, { status: 400 });
  }

  if (newStage === previousStage) {
    return NextResponse.json({ ok: true, stage: newStage });
  }

  const isTerminalMove =
    newStage === "won" ||
    newStage === "lost" ||
    previousStage === "won" ||
    previousStage === "lost";

  if (isTerminalMove && !body.confirmed) {
    return NextResponse.json(
      { error: "Confirmation required for this stage change." },
      { status: 400 }
    );
  }

  if (newStage === "lost" && !body.lostReason?.trim()) {
    return NextResponse.json(
      { error: "Lost reason is required." },
      { status: 400 }
    );
  }

  const result = await applyManualOpportunityStageChange(supabase, {
    opportunityId,
    newStage: newStage as OpportunityStage,
    previousStage: previousStage as OpportunityStage,
    changedBy: auth.userId,
    lostReason: body.lostReason,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  revalidatePath("/admin/opportunities");
  revalidatePath(`/admin/opportunities/${opportunityId}`);

  return NextResponse.json({
    ok: true,
    opportunityId: result.opportunityId,
    stage: result.stage,
  });
}
