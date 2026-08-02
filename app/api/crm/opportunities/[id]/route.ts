import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { updateOpportunityFields } from "@/lib/crm/opportunity-contact";
import {
  parseDateInputValue,
  parseDateTimeLocalValue,
} from "@/lib/crm/format-datetime";
import type { OpportunitySource, OpportunityStage } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";

type PatchBody = {
  contactId?: string;
  companyId?: string;
  title?: string;
  description?: string | null;
  estimatedValue?: string | null;
  stage?: OpportunityStage;
  source?: OpportunitySource;
  expectedCloseDate?: string | null;
  nextFollowUpAt?: string | null;
  lostReason?: string | null;
  timestamps?: Record<string, string | null>;
};

function parseEstimatedValue(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseFloat(trimmed);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: opportunityId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: PatchBody;

  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.stage === "lost" && !body.lostReason?.trim()) {
    return NextResponse.json(
      { error: "Lost reason is required when stage is Lost." },
      { status: 400 }
    );
  }

  const estimatedValue =
    body.estimatedValue !== undefined
      ? parseEstimatedValue(body.estimatedValue)
      : undefined;

  if (
    body.estimatedValue !== undefined &&
    body.estimatedValue?.trim() &&
    estimatedValue === null
  ) {
    return NextResponse.json(
      { error: "Estimated value must be a valid non-negative number." },
      { status: 400 }
    );
  }

  try {
    await updateOpportunityFields(supabase, {
      opportunityId,
      contactId: body.contactId?.trim() || undefined,
      companyId: body.companyId?.trim() || undefined,
      title: body.title?.trim(),
      description: body.description,
      estimatedValue,
      stage: body.stage,
      source: body.source,
      expectedCloseDate:
        body.expectedCloseDate !== undefined
          ? parseDateInputValue(body.expectedCloseDate || "")
          : undefined,
      nextFollowUpAt:
        body.nextFollowUpAt !== undefined
          ? parseDateTimeLocalValue(body.nextFollowUpAt || "")
          : undefined,
      lostReason: body.lostReason,
      timestamps: body.timestamps,
      updatedBy: auth.userId,
    });

    revalidatePath("/admin/opportunities");
    revalidatePath(`/admin/opportunities/${opportunityId}`);
    revalidatePath(`/admin/opportunities/${opportunityId}/edit`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update opportunity.",
      },
      { status: 400 }
    );
  }
}
