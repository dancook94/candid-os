export type ProfileRedirectInfo = {
  account_status: string;
  user_role: string;
};

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
  const safeNext = sanitizeNextPath(next ?? null);

  if (
    profile?.account_status === "approved" &&
    profile.user_role === "admin"
  ) {
    if (safeNext?.startsWith("/admin")) {
      return safeNext;
    }

    return "/admin";
  }

  if (safeNext?.startsWith("/admin")) {
    return "/dashboard";
  }

  if (safeNext) {
    return safeNext;
  }

  return "/dashboard";
}
