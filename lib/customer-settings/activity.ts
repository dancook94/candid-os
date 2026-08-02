import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import type { CustomerSettingsContext } from "@/lib/customer-settings/auth";
import { CustomerSettingsError } from "@/lib/customer-settings/errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const CUSTOMER_SETTINGS_ACTIVITY_TYPES = {
  customerContactUpdated: CRM_ACTIVITY_TYPES.customerContactUpdated,
  customerCompanyUpdated: CRM_ACTIVITY_TYPES.customerCompanyUpdated,
  companyAddressCreated: CRM_ACTIVITY_TYPES.companyAddressCreated,
  companyAddressUpdated: CRM_ACTIVITY_TYPES.companyAddressUpdated,
  companyAddressDeactivated: CRM_ACTIVITY_TYPES.companyAddressDeactivated,
  notificationPreferencesUpdated:
    CRM_ACTIVITY_TYPES.notificationPreferencesUpdated,
} as const;

export type CustomerSettingsActivityType =
  (typeof CUSTOMER_SETTINGS_ACTIVITY_TYPES)[keyof typeof CUSTOMER_SETTINGS_ACTIVITY_TYPES];

const ALLOWED_CUSTOMER_SETTINGS_ACTIVITY_TYPES = new Set<string>(
  Object.values(CUSTOMER_SETTINGS_ACTIVITY_TYPES)
);

export { CRM_ACTIVITY_TYPES };

type LogCustomerSettingsActivityInput = {
  activityType: CustomerSettingsActivityType;
  description: string;
  changedFields: string[];
  addressId?: string | null;
  contactId?: string | null;
};

/**
 * Inserts customer portal settings activity using the service-role client.
 * Ownership IDs are always derived from the authenticated settings context.
 */
export async function logCustomerSettingsActivity(
  context: CustomerSettingsContext,
  input: LogCustomerSettingsActivityInput
): Promise<string> {
  if (!ALLOWED_CUSTOMER_SETTINGS_ACTIVITY_TYPES.has(input.activityType)) {
    throw new CustomerSettingsError("Invalid activity type.", 500);
  }

  const actorProfileId = context.user.id;
  const companyId = context.company.id;
  const contactId = input.contactId ?? context.contact?.id ?? null;

  const metadata: Record<string, unknown> = {
    changed_fields: input.changedFields,
    source: "customer_portal_settings",
  };

  if (input.addressId) {
    metadata.address_id = input.addressId;
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[portal settings] creating activity", {
      activityType: input.activityType,
      actorProfileId,
      companyId,
      contactId,
      changedFields: input.changedFields,
      addressId: input.addressId ?? null,
    });
  }

  const adminClient = createAdminClient();

  try {
    return await createCrmActivity(adminClient, {
      companyId,
      contactId,
      activityType: input.activityType,
      description: input.description,
      metadata,
      actorProfileId,
      validatedLinks: {
        companyId,
        contactId,
        opportunityId: null,
        quoteId: null,
        taskId: null,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[portal settings] activity insert failed", {
        activityType: input.activityType,
        code: (error as { code?: string }).code,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    throw error;
  }
}
