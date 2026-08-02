import { redirect } from "next/navigation";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildLoginUrl } from "@/lib/auth-redirect";
import { getAdminPortalRedirect } from "@/lib/portal-access";

export const ADMIN_PAGE_PROFILE_SELECT =
  "full_name, user_role, account_status, avatar_storage_path";

export type AdminPageProfile = {
  full_name: string | null;
  user_role: string;
  account_status: string;
  avatar_storage_path: string | null;
};

export async function requireAdminPageAccess(
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

  const access = getAdminPortalRedirect(profile, profileError);

  if (access === "login") {
    if (process.env.NODE_ENV === "development" && profileError) {
      console.error("[admin access] profile load failed:", profileError.message);
    }

    redirect(buildLoginUrl(loginPath));
  }

  if (access !== "allow") {
    redirect(access);
  }

  return profile as AdminPageProfile;
}
