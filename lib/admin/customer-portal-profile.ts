import type { SupabaseClient } from "@supabase/supabase-js";

import { loadProfileNotificationContext } from "@/lib/notifications/profile-recipient";

export type CustomerPortalProfile = {
  id: string;
  full_name: string | null;
  requested_company_name: string | null;
  account_status: string;
  company_id: string | null;
  company_name: string | null;
};

export type CompanyPortalUser = {
  profileId: string;
  fullName: string | null;
  email: string;
  accountStatus: string;
  contactId: string | null;
};

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function fetchCompanyApprovedPortalUsers(
  adminClient: SupabaseClient,
  companyId: string
): Promise<{ users: CompanyPortalUser[]; queryError: string | null }> {
  const profileIds = new Set<string>();
  const contactIdByProfileId = new Map<string, string>();

  const [
    { data: companyProfiles, error: profilesError },
    { data: linkedContacts, error: contactsError },
  ] = await Promise.all([
    adminClient
      .from("profiles")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_role", "customer")
      .eq("account_status", "approved"),
    adminClient
      .from("contacts")
      .select(
        "id, profile_id, portal_profile:profiles!contacts_profile_id_fkey(id, account_status, user_role)"
      )
      .eq("company_id", companyId)
      .not("profile_id", "is", null),
  ]);

  if (profilesError) {
    return { users: [], queryError: profilesError.message };
  }

  if (contactsError) {
    return { users: [], queryError: contactsError.message };
  }

  for (const profile of companyProfiles ?? []) {
    profileIds.add(profile.id as string);
  }

  for (const contact of linkedContacts ?? []) {
    const profileId = contact.profile_id as string | null;
    const portalProfile = unwrapRelation(contact.portal_profile);

    if (
      !profileId ||
      portalProfile?.user_role !== "customer" ||
      portalProfile.account_status !== "approved"
    ) {
      continue;
    }

    profileIds.add(profileId);
    contactIdByProfileId.set(profileId, contact.id as string);
  }

  const users = (
    await Promise.all(
      [...profileIds].map(async (profileId) => {
        const context = await loadProfileNotificationContext(adminClient, profileId);

        if (!context || context.accountStatus !== "approved") {
          return null;
        }

        return {
          profileId: context.id,
          fullName: context.fullName,
          email: context.email,
          accountStatus: context.accountStatus,
          contactId: contactIdByProfileId.get(profileId) ?? null,
        } satisfies CompanyPortalUser;
      })
    )
  ).filter((user): user is CompanyPortalUser => user !== null);

  users.sort((left, right) =>
    (left.fullName ?? left.email).localeCompare(right.fullName ?? right.email)
  );

  return { users, queryError: null };
}

export async function fetchCustomerPortalProfileById(
  adminClient: SupabaseClient,
  profileId: string
): Promise<CustomerPortalProfile | null> {
  const { data, error } = await adminClient
    .from("profiles")
    .select(
      "id, full_name, requested_company_name, account_status, company_id, companies(company_name)"
    )
    .eq("id", profileId)
    .eq("user_role", "customer")
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const company = Array.isArray(data.companies)
    ? (data.companies[0] ?? null)
    : data.companies;

  return {
    id: data.id as string,
    full_name: (data.full_name as string | null) ?? null,
    requested_company_name: (data.requested_company_name as string | null) ?? null,
    account_status: data.account_status as string,
    company_id: (data.company_id as string | null) ?? null,
    company_name: (company?.company_name as string | null) ?? null,
  };
}

export async function fetchApprovedCustomerPortalProfiles(
  adminClient: SupabaseClient,
  options: { limit?: number } = {}
) {
  const limit = options.limit ?? 50;

  const { data, error } = await adminClient
    .from("profiles")
    .select(
      "id, full_name, requested_company_name, account_status, company_id, updated_at, companies(company_name)"
    )
    .eq("user_role", "customer")
    .eq("account_status", "approved")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { profiles: [] as CustomerPortalProfile[], queryError: error.message };
  }

  return {
    profiles: (data ?? []).map((row) => {
      const company = Array.isArray(row.companies)
        ? (row.companies[0] ?? null)
        : row.companies;

      return {
        id: row.id as string,
        full_name: (row.full_name as string | null) ?? null,
        requested_company_name: (row.requested_company_name as string | null) ?? null,
        account_status: row.account_status as string,
        company_id: (row.company_id as string | null) ?? null,
        company_name: (company?.company_name as string | null) ?? null,
      };
    }),
    queryError: null as string | null,
  };
}
