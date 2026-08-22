import type { SupabaseClient } from "@supabase/supabase-js";

import { isValidEmail } from "@/lib/notifications/recipient-resolution";

export type ProfileNotificationContext = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  email: string;
  userRole: string;
  accountStatus: string;
  companyId: string | null;
  requestedCompanyName: string | null;
  companyName: string | null;
  createdAt: string | null;
};

export async function loadProfileNotificationContext(
  adminClient: SupabaseClient,
  profileId: string
): Promise<ProfileNotificationContext | null> {
  const { data: profile, error } = await adminClient
    .from("profiles")
    .select(
      "id, full_name, user_role, account_status, company_id, requested_company_name, created_at, companies(company_name)"
    )
    .eq("id", profileId)
    .maybeSingle();

  if (error || !profile) {
    return null;
  }

  const { data: authUser, error: authError } =
    await adminClient.auth.admin.getUserById(profileId);

  if (authError || !authUser.user?.email) {
    return null;
  }

  const email = authUser.user.email.trim().toLowerCase();

  if (!isValidEmail(email)) {
    return null;
  }

  const fullName = (profile.full_name as string | null) ?? null;
  const company = extractSingle(profile.companies);

  return {
    id: profile.id as string,
    fullName,
    firstName: fullName?.split(/\s+/)[0] ?? null,
    email,
    userRole: profile.user_role as string,
    accountStatus: profile.account_status as string,
    companyId: (profile.company_id as string | null) ?? null,
    requestedCompanyName: (profile.requested_company_name as string | null) ?? null,
    companyName: company?.company_name ?? null,
    createdAt: (profile.created_at as string | null) ?? null,
  };
}

function extractSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
