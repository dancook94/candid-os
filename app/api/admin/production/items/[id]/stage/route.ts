import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { ProductionError } from "@/lib/production/errors";
import { applyProductionStageChange } from "@/lib/production/service";
import { isValidProductionStatus } from "@/lib/production/status-sync";
import type { ProductionStatus } from "@/lib/production/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type StageChangeBody = {
  stage?: string;
  previousStage?: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: itemId } = await context.params;
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

  if (!newStage || !isValidProductionStatus(newStage)) {
    return NextResponse.json({ error: "Invalid stage." }, { status: 400 });
  }

  if (!previousStage || !isValidProductionStatus(previousStage)) {
    return NextResponse.json({ error: "Invalid previous stage." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    const result = await applyProductionStageChange(adminClient, {
      itemId,
      newStage: newStage as ProductionStatus,
      previousStage: previousStage as ProductionStatus,
      actorProfileId: auth.userId,
    });

    revalidatePath("/admin/production");
    revalidatePath("/admin/jobs");

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (process.env.NODE_ENV === "development") {
      console.error("[production stage] update failed:", error);
    }

    return NextResponse.json(
      { error: "Unable to update production stage." },
      { status: 500 }
    );
  }
}
