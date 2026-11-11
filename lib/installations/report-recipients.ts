import type { SupabaseClient } from "@supabase/supabase-js";

export type InstallationReportRecipientOption = {
  contactId: string;
  fullName: string;
  email: string;
  hasPortalAccess: boolean;
  isJobContact: boolean;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function loadInstallationReportRecipientOptions(
  adminClient: SupabaseClient,
  input: { companyId: string; jobContactId?: string | null }
): Promise<InstallationReportRecipientOption[]> {
  const { data, error } = await adminClient
    .from("contacts")
    .select("id, full_name, email, profile_id, is_active")
    .eq("company_id", input.companyId)
    .eq("is_active", true)
    .not("email", "is", null);

  if (error) {
    throw new Error(error.message);
  }

  const contacts = (data ?? []).filter(
    (row) => typeof row.email === "string" && row.email.trim().includes("@")
  );

  const profileIds = contacts
    .map((row) => row.profile_id)
    .filter((value): value is string => typeof value === "string");

  const portalProfiles = new Set<string>();
  if (profileIds.length > 0) {
    const { data: profiles } = await adminClient
      .from("profiles")
      .select("id")
      .in("id", profileIds)
      .eq("user_role", "customer")
      .eq("account_status", "approved")
      .eq("company_id", input.companyId);

    for (const profile of profiles ?? []) {
      portalProfiles.add(String(profile.id));
    }
  }

  const options = contacts.map((contact) => {
    const profileId = typeof contact.profile_id === "string" ? contact.profile_id : null;
    return {
      contactId: String(contact.id),
      fullName: String(contact.full_name || "Contact"),
      email: String(contact.email),
      hasPortalAccess: Boolean(profileId && portalProfiles.has(profileId)),
      isJobContact: Boolean(input.jobContactId && input.jobContactId === contact.id),
    };
  });

  options.sort((left, right) => {
    if (left.isJobContact !== right.isJobContact) {
      return left.isJobContact ? -1 : 1;
    }
    return left.fullName.localeCompare(right.fullName);
  });

  return options;
}

export async function assessInstallationReportRecipientPortalAccess(
  adminClient: SupabaseClient,
  input: { companyId: string; recipientEmail: string }
) {
  const email = normalizeEmail(input.recipientEmail);
  const { data: contacts } = await adminClient
    .from("contacts")
    .select("id, profile_id")
    .eq("company_id", input.companyId)
    .ilike("email", email)
    .eq("is_active", true)
    .limit(5);

  const withProfile = (contacts ?? []).find((row) => typeof row.profile_id === "string");
  if (!withProfile?.profile_id) {
    return { hasPortalAccess: false, matchedContactId: null as string | null };
  }

  const { data: profile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("id", withProfile.profile_id)
    .eq("user_role", "customer")
    .eq("account_status", "approved")
    .eq("company_id", input.companyId)
    .maybeSingle();

  return {
    hasPortalAccess: Boolean(profile),
    matchedContactId: String(withProfile.id),
  };
}
