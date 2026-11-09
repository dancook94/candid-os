import { redirect } from "next/navigation";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildLoginUrl } from "@/lib/auth-redirect";
import {
  getStaffPortalRedirect,
  resolveAdminAccessDeniedPath,
  type PortalProfile,
} from "@/lib/portal-access";
import {
  canDecideLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { isStaffRole } from "@/lib/staff-roles";

export const STAFF_LEAVE_PATH = "/staff/leave";
export const ADMIN_LEAVE_PATH = "/admin/leave";
export const ADMIN_LEAVE_SICKNESS_PATH = "/admin/leave/sickness";

export function requireStaffLeavePageAccess(
  profile: PortalProfile | null,
  profileError: Parameters<typeof getStaffPortalRedirect>[1],
  returnPath: string
) {
  const access = getStaffPortalRedirect(profile, profileError);

  if (access === "login") {
    redirect(buildLoginUrl(returnPath));
  }

  if (access !== "allow") {
    redirect(access);
  }

  if (!profile || profile.account_status !== "approved" || !isStaffRole(profile.user_role)) {
    redirect(resolveAdminAccessDeniedPath(profile));
  }

  return profile;
}

export async function requireAdminLeavePageAccess(
  supabase: SupabaseClient,
  returnPath: string
) {
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    redirect(buildLoginUrl(returnPath));
  }

  if (!canDecideLeaveRequests(auth.profile)) {
    redirect(resolveAdminAccessDeniedPath(auth.profile));
  }

  return auth;
}
