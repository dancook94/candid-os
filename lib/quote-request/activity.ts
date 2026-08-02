import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import type { CustomerQuoteRequestContext } from "@/lib/customer-settings/auth";
import { createAdminClient } from "@/lib/supabase/admin";

type QuoteRequestActivityInput = {
  activityType: string;
  description: string;
  metadata: Record<string, unknown>;
  quoteRequestId: string;
  addressId?: string | null;
};

export async function logQuoteRequestCustomerActivity(
  context: CustomerQuoteRequestContext,
  input: QuoteRequestActivityInput
) {
  const adminClient = createAdminClient();

  if (process.env.NODE_ENV === "development") {
    console.log("[quote request] creating activity", {
      activityType: input.activityType,
      quoteRequestId: input.quoteRequestId,
      addressId: input.addressId ?? null,
    });
  }

  await createCrmActivity(adminClient, {
    companyId: context.company.id,
    contactId: context.contact.id,
    activityType: input.activityType,
    description: input.description,
    actorProfileId: context.profile.id,
    metadata: {
      ...input.metadata,
      quote_request_id: input.quoteRequestId,
      ...(input.addressId ? { address_id: input.addressId } : {}),
      source: "customer_quote_request",
    },
    validatedLinks: {
      companyId: context.company.id,
      contactId: context.contact.id,
      opportunityId: null,
      quoteId: null,
      taskId: null,
    },
  });
}

export { CRM_ACTIVITY_TYPES };
