import {
  isAdminRole,
  isCrmRole,
  isStaffRole,
  type StaffRole,
} from "@/lib/staff-roles";

export type InstallationAccessProfile = {
  account_status: string;
  user_role: string;
};

export function isApprovedProfile(profile: InstallationAccessProfile | null | undefined) {
  return profile?.account_status === "approved";
}

/** Admin, sales, and production — not accounts. */
export function canReadInstallations(profile: InstallationAccessProfile | null | undefined) {
  if (!isApprovedProfile(profile)) {
    return false;
  }

  const role = profile!.user_role;
  return (
    isAdminRole(role) ||
    role === "sales" ||
    role === "production"
  );
}

export function canManageInstallations(profile: InstallationAccessProfile | null | undefined) {
  return isApprovedProfile(profile) && isAdminRole(profile!.user_role);
}

/** Production operators and admins — operational field updates. */
export function canOperateInstallations(profile: InstallationAccessProfile | null | undefined) {
  if (!isApprovedProfile(profile)) {
    return false;
  }

  const role = profile!.user_role;
  return isAdminRole(role) || role === "production";
}

export function isSalesReadOnlyInstallation(profile: InstallationAccessProfile | null | undefined) {
  return (
    isApprovedProfile(profile) &&
    profile!.user_role === "sales" &&
    isCrmRole(profile!.user_role)
  );
}

export function assertInstallationCustomerDenied(role: string) {
  return role === "customer";
}

export function formatInstallationRoleLabel(role: string) {
  if (!isStaffRole(role as StaffRole) && role !== "customer") {
    return role;
  }

  return role;
}
