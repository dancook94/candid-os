import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { createOpportunityWithContact } from "@/lib/crm/opportunity-contact";
import {
  parseDateInputValue,
  parseDateTimeLocalValue,
} from "@/lib/crm/format-datetime";
import type { OpportunitySource, OpportunityStage } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";

type CreateBody = {
  companyId?: string;
  contactId?: string;
  title?: string;
  description?: string | null;
  estimatedValue?: string | null;
  stage?: OpportunityStage;
  ownerProfileId?: string;
  collaboratorProfileIds?: string[];
  source?: OpportunitySource;
  expectedCloseDate?: string | null;
  nextFollowUpAt?: string | null;
  lostReason?: string | null;
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: CreateBody;

  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = body.title?.trim() ?? "";

  if (!title) {
    return NextResponse.json(
      { error: "Opportunity title is required." },
      { status: 400 }
    );
  }

  if (!body.companyId?.trim()) {
    return NextResponse.json({ error: "Company is required." }, { status: 400 });
  }

  if (!body.contactId?.trim()) {
    return NextResponse.json({ error: "Contact is required." }, { status: 400 });
  }

  if (!body.ownerProfileId?.trim()) {
    return NextResponse.json({ error: "Owner is required." }, { status: 400 });
  }

  const stage = body.stage ?? "new_enquiry";

  if (stage === "lost" && !body.lostReason?.trim()) {
    return NextResponse.json(
      { error: "Lost reason is required when stage is Lost." },
      { status: 400 }
    );
  }

  const estimatedValue = parseEstimatedValue(body.estimatedValue ?? null);

  if (body.estimatedValue?.trim() && estimatedValue === null) {
    return NextResponse.json(
      { error: "Estimated value must be a valid non-negative number." },
      { status: 400 }
    );
  }

  try {
    const opportunityId = await createOpportunityWithContact(supabase, {
      companyId: body.companyId.trim(),
      contactId: body.contactId.trim(),
      title,
      description: body.description,
      estimatedValue,
      stage,
      ownerProfileId: body.ownerProfileId.trim(),
      collaboratorProfileIds: body.collaboratorProfileIds ?? [],
      source: body.source ?? "admin",
      expectedCloseDate: parseDateInputValue(body.expectedCloseDate || ""),
      nextFollowUpAt: parseDateTimeLocalValue(body.nextFollowUpAt || ""),
      lostReason: body.lostReason,
      createdBy: auth.userId,
    });

    revalidatePath("/admin/opportunities");
    revalidatePath(`/admin/opportunities/${opportunityId}`);

    return NextResponse.json({ ok: true, opportunityId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create opportunity.",
      },
      { status: 400 }
    );
  }
}
