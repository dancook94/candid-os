import { NextResponse } from "next/server";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { createOpportunityFromQuoteRequest } from "@/lib/crm/opportunity-linking";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function verifyQuoteRequestAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quoteRequestId: string
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, status: 401, message: "Unauthorized." };
  }

  const crmAuth = await verifyApprovedCrmStaff(supabase);

  if (crmAuth.ok) {
    return { ok: true as const, userId: crmAuth.userId, useAdminClient: false };
  }

  const { data: quoteRequest } = await supabase
    .from("quote_requests")
    .select("id, requested_by")
    .eq("id", quoteRequestId)
    .maybeSingle();

  if (!quoteRequest) {
    return { ok: false as const, status: 404, message: "Quote request not found." };
  }

  if (quoteRequest.requested_by !== user.id) {
    return { ok: false as const, status: 403, message: "Forbidden." };
  }

  return { ok: true as const, userId: user.id, useAdminClient: true };
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: quoteRequestId } = await context.params;
  const supabase = await createClient();
  const access = await verifyQuoteRequestAccess(supabase, quoteRequestId);

  if (!access.ok) {
    return NextResponse.json(
      { error: access.message },
      { status: access.status }
    );
  }

  try {
    const writeClient = access.useAdminClient ? createAdminClient() : supabase;
    const result = await createOpportunityFromQuoteRequest(writeClient, {
      quoteRequestId,
      createdBy: access.userId,
    });

    return NextResponse.json({
      ok: true,
      opportunityId: result.opportunityId,
      created: result.created,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to link quote request to opportunity.",
      },
      { status: 400 }
    );
  }
}
