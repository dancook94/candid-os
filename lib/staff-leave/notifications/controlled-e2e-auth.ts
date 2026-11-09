import { createHash } from "node:crypto";

import { isTestAppEnvironment } from "@/lib/app-env";
import { cronAuthorizationMatches } from "@/lib/gmail/cron-auth";

const E2E_SALT = "staff-leave-controlled-e2e-v1";

/** Deterministic Test-only bearer for automated E2E (never valid on Live). */
export function staffLeaveControlledE2eBearerToken(serviceRoleKey: string) {
  return createHash("sha256").update(`${serviceRoleKey.trim()}:${E2E_SALT}`).digest("hex");
}

export function staffLeaveControlledE2eAuthorized(
  request: Request,
  serviceRoleKey: string | undefined
) {
  if (!isTestAppEnvironment() || !serviceRoleKey?.trim()) {
    return false;
  }

  const url = new URL(request.url);
  if (url.searchParams.get("e2eAuth") !== "1") {
    return false;
  }

  if (request.headers.get("x-staff-leave-e2e") !== "1") {
    return false;
  }

  return cronAuthorizationMatches(
    request.headers.get("authorization"),
    staffLeaveControlledE2eBearerToken(serviceRoleKey)
  );
}
