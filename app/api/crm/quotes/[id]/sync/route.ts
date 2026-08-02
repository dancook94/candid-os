import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import {
  syncOpportunityFromQuoteEvent,
  type QuoteOpportunitySyncEvent,
} from "@/lib/crm/opportunity-stage-sync";
import { createClient } from "@/lib/supabase/server";

type SyncBody = {
  event?: QuoteOpportunitySyncEvent;
  lostReason?: string;
};

const VALID_EVENTS: QuoteOpportunitySyncEvent[] = [
  "quote_draft_created",
  "quote_sent",
  "quote_accepted",
  "quote_declined",
];

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: quoteId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: SyncBody;

  try {
    body = (await request.json()) as SyncBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.event || !VALID_EVENTS.includes(body.event)) {
    return NextResponse.json({ error: "Invalid sync event." }, { status: 400 });
  }

  const result = await syncOpportunityFromQuoteEvent(supabase, {
    quoteId,
    event: body.event,
    changedBy: auth.userId,
    lostReason: body.lostReason,
  });

  if (!result.ok && "message" in result) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  if ("opportunityId" in result && result.ok) {
    revalidatePath("/admin/opportunities");
    revalidatePath(`/admin/opportunities/${result.opportunityId}`);
  }

  return NextResponse.json(result);
}
