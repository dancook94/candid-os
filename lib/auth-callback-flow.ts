import type { ProfileRedirectInfo } from "@/lib/auth-redirect";
import { resolvePostLoginPath, sanitizeNextPath } from "@/lib/auth-redirect";
import type { CallbackEmailOtpType } from "@/lib/auth-invite-redirect";
import { CUSTOMER_AWAITING_APPROVAL_PATH } from "@/lib/customer-portal-access";
import { isCustomerRole } from "@/lib/portal-access";

export const AUTH_CALLBACK_DESTINATIONS = {
  registerConfirmed: CUSTOMER_AWAITING_APPROVAL_PATH,
  setPassword: "/set-password",
} as const;

export type AuthCallbackFlow =
  | "registration_confirm"
  | "password_recovery"
  | "invite_set_password"
  | "email_change"
  | "unknown";

export function resolveAuthCallbackFlow(input: {
  safeNext: string | null;
  otpType: CallbackEmailOtpType | null;
}): AuthCallbackFlow {
  if (input.safeNext === AUTH_CALLBACK_DESTINATIONS.registerConfirmed) {
    return "registration_confirm";
  }

  if (input.otpType === "recovery") {
    return "password_recovery";
  }

  if (input.otpType === "invite") {
    return "invite_set_password";
  }

  if (input.safeNext === AUTH_CALLBACK_DESTINATIONS.setPassword) {
    return "invite_set_password";
  }

  if (input.otpType === "email_change") {
    return "email_change";
  }

  if (input.otpType === "signup" || input.otpType === "email") {
    return "registration_confirm";
  }

  return "unknown";
}

export function inferAuthCallbackFlowFromProfile(input: {
  profile: ProfileRedirectInfo;
  otpType: CallbackEmailOtpType | null;
  usedCodeExchange: boolean;
  safeNext: string | null;
}): AuthCallbackFlow {
  if (
    isCustomerRole(input.profile.user_role) &&
    input.profile.account_status === "pending" &&
    input.usedCodeExchange &&
    input.safeNext !== AUTH_CALLBACK_DESTINATIONS.setPassword &&
    input.otpType !== "recovery" &&
    input.otpType !== "invite"
  ) {
    return "registration_confirm";
  }

  return "unknown";
}

export function resolveAuthCallbackDestination(input: {
  flow: AuthCallbackFlow;
  profile: ProfileRedirectInfo;
  safeNext: string | null;
}) {
  switch (input.flow) {
    case "registration_confirm":
      return AUTH_CALLBACK_DESTINATIONS.registerConfirmed;
    case "password_recovery":
    case "invite_set_password":
      return AUTH_CALLBACK_DESTINATIONS.setPassword;
    case "email_change":
    case "unknown":
    default:
      return resolvePostLoginPath(input.profile, input.safeNext);
  }
}

export function resolveAuthCallbackFlowLabel(flow: AuthCallbackFlow) {
  switch (flow) {
    case "registration_confirm":
      return "registration";
    case "password_recovery":
      return "recovery";
    case "invite_set_password":
      return "invite";
    case "email_change":
      return "email_change";
    default:
      return "general";
  }
}

export function sanitizeCallbackNext(next: string | null | undefined) {
  return sanitizeNextPath(next);
}
