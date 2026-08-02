import type { SupabaseClient } from "@supabase/supabase-js";

import type { CustomerSettingsContext } from "@/lib/customer-settings/auth";
import { loadCompanyAddresses } from "@/lib/customer-settings/addresses";
import { loadContactNotificationPreferences } from "@/lib/customer-settings/notifications";
import { fetchContactsList } from "@/lib/crm/contacts";
import { createAdminClient } from "@/lib/supabase/admin";

export type CustomerSettingsPayload = {
  profile: {
    fullName: string | null;
    loginEmail: string;
    updatedAt: string | null;
  };
  contact: CustomerSettingsContext["contact"];
  company: CustomerSettingsContext["company"];
  companyContacts: Array<{
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    job_title: string | null;
    is_primary: boolean;
    isSelf: boolean;
  }>;
  addresses: Awaited<ReturnType<typeof loadCompanyAddresses>>;
  notifications: Awaited<ReturnType<typeof loadContactNotificationPreferences>>;
};

export async function loadCustomerSettingsPayload(
  _supabase: SupabaseClient,
  context: CustomerSettingsContext
): Promise<CustomerSettingsPayload> {
  const adminClient = createAdminClient();

  const [{ contacts }, addresses, notifications] = await Promise.all([
    fetchContactsList(adminClient, { companyId: context.company.id }),
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
    companyContacts: contacts
      .filter((row) => row.is_active)
      .map((row) => ({
        id: row.id,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        job_title: row.job_title,
        is_primary: row.is_primary,
        isSelf: row.profile_id === context.user.id,
      })),
    addresses,
    notifications,
  };
}
