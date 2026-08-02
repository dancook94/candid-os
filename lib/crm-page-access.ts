import { redirect } from "next/navigation";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildLoginUrl } from "@/lib/auth-redirect";
import {
  ADMIN_PAGE_PROFILE_SELECT,
  type AdminPageProfile,
} from "@/lib/admin-page-access";
import { isCrmRole } from "@/lib/staff-roles";

function resolveCrmAccessDeniedPath(profile: AdminPageProfile) {
  if (profile.user_role === "sales") {
    return "/staff";
  }

  if (
    profile.user_role === "production" ||
    profile.user_role === "accounts"
  ) {
    return "/staff";
  }

  return "/admin";
}

export async function requireCrmPageAccess(
  supabase: SupabaseClient,
  loginPath: string
): Promise<AdminPageProfile> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl(loginPath));
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(ADMIN_PAGE_PROFILE_SELECT)
    .eq("id", user.id)
    .single();

  if (profileError || !profile || profile.account_status !== "approved") {
    if (process.env.NODE_ENV === "development" && profileError) {
      console.error("[crm access] profile load failed:", profileError.message);
    }

    redirect(buildLoginUrl(loginPath));
  }

  if (!isCrmRole(profile.user_role)) {
    redirect(resolveCrmAccessDeniedPath(profile as AdminPageProfile));
  }

  return profile as AdminPageProfile;
}
