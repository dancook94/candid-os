import { NextResponse } from "next/server";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { createOpportunityFromQuoteRequest } from "@/lib/crm/opportunity-linking";
import { revalidateQuoteWorkflowRoutes } from "@/lib/quote-route-revalidation";
import {
  requireCustomerQuoteRequestContext,
} from "@/lib/customer-settings/auth";
import { customerSettingsErrorResponse } from "@/lib/customer-settings/api-response";
import { CustomerSettingsError } from "@/lib/customer-settings/errors";
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
    return {
      ok: true as const,
      actorProfileId: crmAuth.userId,
      contactId: null as string | null,
      useAdminClient: false,
    };
  }

  try {
    const context = await requireCustomerQuoteRequestContext(supabase, user);
    const adminClient = createAdminClient();
    const { data: quoteRequest, error } = await adminClient
      .from("quote_requests")
      .select("id, company_id, requested_by, opportunity_id")
      .eq("id", quoteRequestId)
      .maybeSingle();

    if (error) {
      return {
        ok: false as const,
        status: 500,
        message: "Unable to verify quote request access.",
      };
    }

    if (!quoteRequest) {
      return {
        ok: false as const,
        status: 404,
        message: "Quote request not found.",
      };
    }

    if (quoteRequest.company_id !== context.company.id) {
      return { ok: false as const, status: 403, message: "Forbidden." };
    }

    if (quoteRequest.requested_by !== context.profile.id) {
      return { ok: false as const, status: 403, message: "Forbidden." };
    }

    return {
      ok: true as const,
      actorProfileId: context.profile.id,
      contactId: context.contact.id,
      useAdminClient: true,
    };
  } catch (error) {
    if (error instanceof CustomerSettingsError) {
      return {
        ok: false as const,
        status: error.status,
        message: error.message,
      };
    }

    throw error;
  }
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
      actorProfileId: access.actorProfileId,
      contactId: access.contactId,
    });

    revalidateQuoteWorkflowRoutes({ quoteRequestId });

    return NextResponse.json({
      ok: true,
      opportunityId: result.opportunityId,
      created: result.created,
    });
  } catch (error) {
    if (error instanceof CustomerSettingsError) {
      return customerSettingsErrorResponse(error);
    }

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
