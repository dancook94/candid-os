import type { PostgrestError } from "@supabase/supabase-js";

import {
  ADMIN_ROLES,
  isAdminRole,
  isLimitedStaffRole,
  isStaffRole,
} from "@/lib/staff-roles";

export type PortalProfile = {
  account_status: string;
  user_role: string;
};

export function canAccessAdmin(profile: PortalProfile | null | undefined) {
  return (
    profile?.account_status === "approved" && isAdminRole(profile.user_role)
  );
}

export function canAccessStaff(profile: PortalProfile | null | undefined) {
  return (
    profile?.account_status === "approved" && isStaffRole(profile.user_role)
  );
}

export function isCustomerRole(role: string) {
  return role === "customer";
}

export function resolveApprovedRoleHomePath(profile: PortalProfile) {
  if (profile.account_status !== "approved") {
    return "/dashboard";
  }

  if (isAdminRole(profile.user_role)) {
    return "/admin";
  }

  if (isLimitedStaffRole(profile.user_role)) {
    return "/staff";
  }

  return "/dashboard";
}

export function resolveAdminAccessDeniedPath(
  profile: PortalProfile | null | undefined
) {
  if (!profile) {
    return "/login";
  }

  if (profile.account_status === "pending") {
    return "/dashboard";
  }

  if (isLimitedStaffRole(profile.user_role)) {
    return "/staff";
  }

  return "/dashboard";
}

export function getDashboardRoleRedirect(
  profile: PortalProfile | null | undefined
) {
  if (!profile || profile.account_status !== "approved") {
    return null;
  }

  const homePath = resolveApprovedRoleHomePath(profile);

  if (homePath === "/dashboard") {
    return null;
  }

  return homePath;
}

export function getAdminPortalRedirect(
  profile: PortalProfile | null | undefined,
  profileError?: PostgrestError | null
) {
  if (profileError || !profile) {
    return "login" as const;
  }

  if (canAccessAdmin(profile)) {
    return "allow" as const;
  }

  return resolveAdminAccessDeniedPath(profile);
}

export function getStaffPortalRedirect(
  profile: PortalProfile | null | undefined,
  profileError?: PostgrestError | null
) {
  if (profileError || !profile) {
    return "login" as const;
  }

  if (profile.account_status !== "approved") {
    return "/login";
  }

  if (isCustomerRole(profile.user_role)) {
    return "/dashboard";
  }

  if (!isStaffRole(profile.user_role)) {
    return "/dashboard";
  }

  return "allow" as const;
}

export { ADMIN_ROLES };
