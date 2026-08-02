import type { SupabaseClient } from "@supabase/supabase-js";

import type { CustomerSettingsContext } from "@/lib/customer-settings/auth";
import { loadCompanyAddresses } from "@/lib/customer-settings/addresses";
import { loadContactNotificationPreferences } from "@/lib/customer-settings/notifications";
import { loadCompanyContactsForSettings } from "@/lib/customer-settings/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export type CustomerSettingsPayload = {
  profile: {
    fullName: string | null;
    loginEmail: string;
    updatedAt: string | null;
  };
  contact: CustomerSettingsContext["contact"];
  company: CustomerSettingsContext["company"];
  companyContacts: Awaited<ReturnType<typeof loadCompanyContactsForSettings>>;
  addresses: Awaited<ReturnType<typeof loadCompanyAddresses>>;
  notifications: Awaited<ReturnType<typeof loadContactNotificationPreferences>>;
};

export async function loadCustomerSettingsPayload(
  _supabase: SupabaseClient,
  context: CustomerSettingsContext
): Promise<CustomerSettingsPayload> {
  const adminClient = createAdminClient();

  const [companyContacts, addresses, notifications] = await Promise.all([
    loadCompanyContactsForSettings(
      adminClient,
      context.company.id,
      context.user.id
    ),
    loadCompanyAddresses(adminClient, context.company.id),
    context.contact
      ? loadContactNotificationPreferences(adminClient, context.contact.id)
      : Promise.resolve({
          available: false,
          preferences: {
            quote_received: true,
            quote_reminder: true,
            artwork_approval_required: true,
            job_started: true,
            job_ready: true,
            job_dispatched: true,
            invoice_available: true,
            marketing: false,
          },
          updatedAt: null,
        }),
  ]);

  return {
    profile: {
      fullName: context.profile.full_name,
      loginEmail: context.loginEmail,
      updatedAt: context.profile.updated_at,
    },
    contact: context.contact,
    company: context.company,
    companyContacts,
    addresses,
    notifications,
  };
}
