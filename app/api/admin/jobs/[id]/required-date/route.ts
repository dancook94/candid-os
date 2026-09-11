import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { updateJobRequiredDate } from "@/lib/jobs/production-deadline";
import { postJobProductionDeadlineTimelineEventSafe } from "@/lib/slack/job-timeline";
import { ProductionError } from "@/lib/production/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RequiredDateBody = {
  requiredDate?: string | null;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: RequiredDateBody;

  try {
    body = (await request.json()) as RequiredDateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    const result = await updateJobRequiredDate(
      adminClient,
      jobId,
      body.requiredDate ?? null
    );

    if (result.changed) {
      try {
        await postJobProductionDeadlineTimelineEventSafe(adminClient, {
          jobId,
          oldDate: result.previousRequiredDate,
          newDate: result.requiredDate,
          actorProfileId: auth.userId,
        });
      } catch (slackError) {
        if (process.env.NODE_ENV === "development") {
          console.error("[jobs] Slack production deadline timeline failed", slackError);
        }
      }
    }

    revalidatePath("/admin/production");
    revalidatePath(`/admin/jobs/${jobId}`);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error ? error.message : "Unable to update production deadline.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
