import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { buildLoginUrl } from "@/lib/auth-redirect";
import { canAccessStaff, isCustomerRole } from "@/lib/portal-access";

export type UpdatesPortalProfile = {
  full_name: string | null;
  user_role: string;
  account_status: string;
  company_id: string | null;
  avatar_storage_path?: string | null;
};

export async function getUpdatesPageAccess(
  supabase: SupabaseClient,
  loginPath = "/updates"
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, status: 401, message: "Unauthorized." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status, company_id, avatar_storage_path")
    .eq("id", user.id)
    .single();

  if (!profile || profile.account_status !== "approved") {
    return { ok: false as const, status: 403, message: "Forbidden." };
  }

  if (!isCustomerRole(profile.user_role) && !canAccessStaff(profile)) {
    return { ok: false as const, status: 403, message: "Forbidden." };
  }

  return {
    ok: true as const,
    user,
    profile: profile as UpdatesPortalProfile,
  };
}

export async function requireUpdatesPageAccess(
  supabase: SupabaseClient,
  loginPath = "/updates"
) {
  const access = await getUpdatesPageAccess(supabase, loginPath);

  if (!access.ok) {
    redirect(buildLoginUrl(loginPath));
  }

  return { user: access.user, profile: access.profile };
}

export function resolveReporterContext(
  user: User,
  profile: UpdatesPortalProfile
) {
  return {
    reporterId: user.id,
    reporterName:
      profile.full_name ||
      (user.user_metadata?.full_name as string | undefined) ||
      user.email ||
      "Candid OS user",
    reporterEmail: user.email ?? "",
    reporterRole: profile.user_role,
    companyId: profile.company_id ?? null,
  };
}
