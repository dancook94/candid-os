import type { SupabaseClient } from "@supabase/supabase-js";

import { CONTACTS_PROFILE_ID_FKEY } from "@/lib/crm/contacts";

export type QuoteContactDisplay = {
  id: string;
  full_name: string;
  email: string | null;
  job_title: string | null;
  company_id: string;
  company_name: string;
  profile_id: string | null;
  portal_access: "portal" | "email_only";
};

export async function loadQuoteContactDisplay(
  supabase: SupabaseClient,
  contactId: string | null | undefined
): Promise<QuoteContactDisplay | null> {
  if (!contactId) {
    return null;
  }

  const { data: contact, error } = await supabase
    .from("contacts")
    .select(
      `
      id,
      full_name,
      email,
      job_title,
      company_id,
      profile_id,
      companies ( company_name ),
      portal_profile:profiles!${CONTACTS_PROFILE_ID_FKEY} (
        account_status
      )
    `
    )
    .eq("id", contactId)
    .maybeSingle();

  if (error || !contact) {
    return null;
  }

  const company = Array.isArray(contact.companies)
    ? contact.companies[0]
    : contact.companies;
  const profile = Array.isArray(contact.portal_profile)
    ? contact.portal_profile[0]
    : contact.portal_profile;

  const hasPortalAccess =
    Boolean(contact.profile_id) && profile?.account_status === "approved";

  return {
    id: contact.id,
    full_name: contact.full_name,
    email: contact.email,
    job_title: contact.job_title,
    company_id: contact.company_id,
    company_name: company?.company_name ?? "Unknown company",
    profile_id: contact.profile_id,
    portal_access: hasPortalAccess ? "portal" : "email_only",
  };
}

export async function loadQuoteContactsByIds(
  supabase: SupabaseClient,
  contactIds: string[]
): Promise<Map<string, QuoteContactDisplay>> {
  const uniqueIds = [...new Set(contactIds.filter(Boolean))];
  const byId = new Map<string, QuoteContactDisplay>();

  if (uniqueIds.length === 0) {
    return byId;
  }

  await Promise.all(
    uniqueIds.map(async (contactId) => {
      const contact = await loadQuoteContactDisplay(supabase, contactId);

      if (contact) {
        byId.set(contactId, contact);
      }
    })
  );

  return byId;
}
