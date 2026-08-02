export const ADMIN_ROLES = ["super_admin", "admin"] as const;

export const STAFF_ROLES = [
  "super_admin",
  "admin",
  "sales",
  "production",
  "accounts",
] as const;

export const INVITEABLE_STAFF_ROLES = [
  "admin",
  "sales",
  "production",
  "accounts",
] as const;

export const CRM_ROLES = ["super_admin", "admin", "sales"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];
export type InviteableStaffRole = (typeof INVITEABLE_STAFF_ROLES)[number];
export type CrmRole = (typeof CRM_ROLES)[number];

export function isAdminRole(role: string): role is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

export function isCandidAdminRole(role: string) {
  return isAdminRole(role);
}

export function isSuperAdminRole(role: string) {
  return role === "super_admin";
}

export function isLimitedStaffRole(role: string) {
  return role === "sales" || role === "production" || role === "accounts";
}

export function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

export function isInviteableStaffRole(role: string): role is InviteableStaffRole {
  return (INVITEABLE_STAFF_ROLES as readonly string[]).includes(role);
}

export function isCrmRole(role: string): role is CrmRole {
  return (CRM_ROLES as readonly string[]).includes(role);
}

export function formatRoleLabel(role: string) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
