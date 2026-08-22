import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import {
  syncOpportunityFromQuoteEvent,
  type QuoteOpportunitySyncEvent,
} from "@/lib/crm/opportunity-stage-sync";
import { notifyQuoteReadySafe } from "@/lib/notifications/triggers";
import { revalidateQuoteWorkflowRoutes } from "@/lib/quote-route-revalidation";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const { data: quoteLink } = await supabase
    .from("quotes")
    .select("quote_request_id")
    .eq("id", quoteId)
    .maybeSingle();

  revalidateQuoteWorkflowRoutes({
    quoteId,
    quoteRequestId: quoteLink?.quote_request_id ?? null,
  });

  if (body.event === "quote_sent" && result.ok) {
    const adminClient = createAdminClient();
    const [{ data: version }, { data: quote }] = await Promise.all([
      adminClient
        .from("quote_versions")
        .select("id")
        .eq("quote_id", quoteId)
        .eq("version_status", "sent")
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
      adminClient
        .from("quotes")
        .select("contact_id")
        .eq("id", quoteId)
        .maybeSingle(),
    ]);

    const quoteReadyNotification = await notifyQuoteReadySafe(adminClient, {
      quoteId,
      versionId: version?.id ?? null,
      contactId: quote?.contact_id ?? null,
    });

    if (process.env.NODE_ENV === "development") {
      console.info("[quote_sent] quote_ready notification", quoteReadyNotification);
    }
  }

  return NextResponse.json(result);
}
