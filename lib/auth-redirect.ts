import {
  isAdminRole,
  isLimitedStaffRole,
} from "@/lib/staff-roles";
import type { PortalProfile } from "@/lib/portal-access";
import { resolveApprovedRoleHomePath } from "@/lib/portal-access";

export type ProfileRedirectInfo = PortalProfile;

export function sanitizeNextPath(next: string | null | undefined) {
  if (!next) {
    return null;
  }

  if (!next.startsWith("/") || next.startsWith("//")) {
    return null;
  }

  if (next.includes("://")) {
    return null;
  }

  return next;
}

export function resolveInviteCallbackNextPath(next: string | null | undefined) {
  return sanitizeNextPath(next) ?? "/set-password";
}

export function buildLoginUrl(nextPath?: string | null) {
  const safeNext = sanitizeNextPath(nextPath ?? null);

  if (!safeNext) {
    return "/login";
  }

  return `/login?next=${encodeURIComponent(safeNext)}`;
}

export function resolvePostLoginPath(
  profile: ProfileRedirectInfo | null,
  next: string | null | undefined
) {
  if (!profile) {
    return "/login";
  }

  const safeNext = sanitizeNextPath(next ?? null);
  const homePath = resolveApprovedRoleHomePath(profile);

  if (profile.account_status === "approved") {
    if (isAdminRole(profile.user_role)) {
      if (safeNext?.startsWith("/admin")) {
        return safeNext;
      }

      return "/admin";
    }

    if (isLimitedStaffRole(profile.user_role)) {
      if (safeNext?.startsWith("/staff")) {
        return safeNext;
      }

      return "/staff";
    }
  }

  if (safeNext?.startsWith("/admin") || safeNext?.startsWith("/staff")) {
    return homePath;
  }

  if (safeNext) {
    return safeNext;
  }

  return homePath;
}

export {
  getDashboardRoleRedirect,
  resolveApprovedRoleHomePath,
} from "@/lib/portal-access";
