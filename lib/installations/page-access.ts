import { redirect } from "next/navigation";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ADMIN_PAGE_PROFILE_SELECT,
  type AdminPageProfile,
} from "@/lib/admin-page-access";
import { buildLoginUrl } from "@/lib/auth-redirect";
import { canReadInstallations } from "@/lib/installations/permissions";
import { resolveApprovedRoleHomePath } from "@/lib/portal-access";

export async function requireInstallationReader(
  supabase: SupabaseClient,
  loginPath: string
): Promise<AdminPageProfile> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl(loginPath));
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(ADMIN_PAGE_PROFILE_SELECT)
    .eq("id", user.id)
    .single();

  if (error || !profile || !canReadInstallations(profile)) {
    if (profile) {
      redirect(resolveApprovedRoleHomePath(profile));
    }

    redirect(buildLoginUrl(loginPath));
  }

  return profile as AdminPageProfile;
}
