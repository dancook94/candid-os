import type { SupabaseClient } from "@supabase/supabase-js";

import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import type { CustomerSettingsContext } from "@/lib/customer-settings/auth";

export async function logCustomerSettingsActivity(
  supabase: SupabaseClient,
  context: CustomerSettingsContext,
  {
    activityType,
    description,
    changedFields,
    contactId,
  }: {
    activityType: string;
    description: string;
    changedFields: string[];
    contactId?: string | null;
  }
) {
  await createCrmActivity(supabase, {
    companyId: context.company.id,
    contactId: contactId ?? context.contact?.id ?? null,
    activityType,
    description,
    metadata: {
      changed_fields: changedFields,
      source: "customer_portal_settings",
    },
    actorProfileId: context.user.id,
  });
}

export { CRM_ACTIVITY_TYPES };
