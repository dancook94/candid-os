import type { SupabaseClient, User } from "@supabase/supabase-js";

import { getDashboardRoleRedirect } from "@/lib/auth-redirect";
import { loadCustomerCompanyBranding } from "@/lib/customer-company-branding";
import { loadCustomerSettingsProfile } from "@/lib/customer-settings/queries";
import { getCustomerPortalStatusSubtitle } from "@/lib/customer-portal-status";
import { loadProfileAvatarSignedUrl } from "@/lib/staff-avatar-server";

export type CustomerPortalProfile = {
  full_name: string | null;
  company_id: string | null;
  account_status: string | null;
  user_role: string | null;
  avatar_storage_path?: string | null;
  updated_at?: string | null;
};

export function resolveCustomerDisplayName(
  profile: CustomerPortalProfile | null | undefined,
  user: User
) {
  return (
    profile?.full_name ||
    (user.user_metadata?.full_name as string | undefined) ||
    user.email ||
    "Customer"
  );
}

export async function loadCustomerPortalProfile(
  supabase: SupabaseClient,
  userId: string
) {
  return loadCustomerSettingsProfile(supabase, userId);
}

export async function requireCustomerPortalUser(
  supabase: SupabaseClient,
  user: User,
  redirectFn: (path: string) => never
) {
  const profile = await loadCustomerPortalProfile(supabase, user.id);

  if (!profile) {
    redirectFn("/login");
  }

  const roleRedirect = getDashboardRoleRedirect(profile);

  if (roleRedirect) {
    redirectFn(roleRedirect);
  }

  if (profile.user_role !== "customer") {
    redirectFn("/login");
  }

  return profile;
}

export async function buildCustomerAppShellProps(
  supabase: SupabaseClient,
  user: User,
  profile: CustomerPortalProfile | null | undefined
) {
  const userName = resolveCustomerDisplayName(profile, user);
  const accountStatusSubtitle = getCustomerPortalStatusSubtitle(
    profile?.account_status
  );

  const companyBranding = await loadCustomerCompanyBranding(
    supabase,
    profile?.company_id,
    (user.user_metadata?.company_name as string | undefined) || "Your company"
  );

  return {
    userRole: "customer" as const,
    userName,
    accountStatusSubtitle,
    companyName: companyBranding.companyName,
    companyLogoUrl: companyBranding.companyLogoUrl,
    userAvatarUrl: await loadProfileAvatarSignedUrl(
      supabase,
      profile ?? { avatar_storage_path: null }
    ),
  };
}
