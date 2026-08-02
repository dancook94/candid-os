import { redirect } from "next/navigation";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildLoginUrl } from "@/lib/auth-redirect";
import { ADMIN_PAGE_PROFILE_SELECT, type AdminPageProfile } from "@/lib/admin-page-access";
import { isAdminRole } from "@/lib/staff-roles";

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

  if (!isAdminRole(profile.user_role)) {
    redirect("/admin");
  }

  return profile as AdminPageProfile;
}
