/**
 * Supabase redirect target for password setup after invite or recovery email.
 */
export function buildInvitePasswordSetupRedirect(origin: string) {
  return `${origin}/auth/callback?next=/set-password`;
}

/** Self-registration email confirmation returns here after Supabase verifies the link. */
export function buildRegistrationConfirmRedirect(origin: string) {
  return `${origin}/auth/callback?next=/register/confirmed`;
}

export const SUPPORTED_CALLBACK_OTP_TYPES = [
  "recovery",
  "invite",
  "email",
  "signup",
  "email_change",
] as const;

export type CallbackEmailOtpType = (typeof SUPPORTED_CALLBACK_OTP_TYPES)[number];

export function parseCallbackEmailOtpType(
  value: string | null | undefined
): CallbackEmailOtpType | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return SUPPORTED_CALLBACK_OTP_TYPES.includes(normalized as CallbackEmailOtpType)
    ? (normalized as CallbackEmailOtpType)
    : null;
}

export const AUTH_CALLBACK_ERRORS = {
  missingAuthCode: "missing_auth_code",
  confirmationExpired: "confirmation_expired",
  confirmationInvalid: "confirmation_invalid",
  callbackFailed: "callback_failed",
  alreadyConfirmed: "already_confirmed",
  /** @deprecated Use missingAuthCode */
  missingInvitationCode: "missing_invitation_code",
  /** @deprecated Use confirmationExpired */
  invitationExpired: "invitation_expired",
  /** @deprecated Use confirmationInvalid or callbackFailed */
  invitationExchangeFailed: "invitation_exchange_failed",
  /** @deprecated Use callbackFailed */
  inviteAuthError: "invite_auth_error",
} as const;

export type AuthCallbackErrorCode =
  (typeof AUTH_CALLBACK_ERRORS)[keyof typeof AUTH_CALLBACK_ERRORS];

export type AuthCallbackErrorFlow =
  | "registration"
  | "recovery"
  | "invite"
  | "email_change"
  | "general";

export function mapAuthCallbackFailure(error: {
  message?: string;
  code?: string;
} | null | undefined): AuthCallbackErrorCode {
  const message = (error?.message ?? "").toLowerCase();
  const code = (error?.code ?? "").toLowerCase();

  if (
    message.includes("already confirmed") ||
    message.includes("already verified") ||
    message.includes("email already confirmed")
  ) {
    return AUTH_CALLBACK_ERRORS.alreadyConfirmed;
  }

  if (
    message.includes("expired") ||
    code.includes("expired") ||
    (message.includes("invalid") &&
      (message.includes("code") ||
        message.includes("token") ||
        message.includes("otp")))
  ) {
    return AUTH_CALLBACK_ERRORS.confirmationExpired;
  }

  if (
    message.includes("already been used") ||
    message.includes("already used") ||
    code.includes("otp_disabled")
  ) {
    return AUTH_CALLBACK_ERRORS.confirmationExpired;
  }

  if (message.includes("invalid") || code.includes("invalid")) {
    return AUTH_CALLBACK_ERRORS.confirmationInvalid;
  }

  return AUTH_CALLBACK_ERRORS.callbackFailed;
}

export function getAuthCallbackErrorMessage(
  code: string | null | undefined,
  flow: AuthCallbackErrorFlow = "general"
) {
  switch (code) {
    case AUTH_CALLBACK_ERRORS.missingAuthCode:
    case AUTH_CALLBACK_ERRORS.missingInvitationCode:
      return "This link is missing verification details. Open the latest email from Candid Creative and try again.";
    case AUTH_CALLBACK_ERRORS.confirmationExpired:
    case AUTH_CALLBACK_ERRORS.invitationExpired:
      if (flow === "registration") {
        return "This confirmation link has expired. Register again or contact Candid Creative if you need help.";
      }

      if (flow === "recovery") {
        return "This password reset link has expired. Request a new reset link from the sign-in page.";
      }

      if (flow === "invite") {
        return "This invitation link has expired. Ask your Candid Creative contact to resend your portal invitation.";
      }

      return "This link has expired. Request a new email from Candid Creative and try again.";
    case AUTH_CALLBACK_ERRORS.confirmationInvalid:
    case AUTH_CALLBACK_ERRORS.invitationExchangeFailed:
      if (flow === "registration") {
        return "We could not confirm your email address. Register again or contact Candid Creative if the problem continues.";
      }

      return "We could not verify this link. Request a new email from Candid Creative and try again.";
    case AUTH_CALLBACK_ERRORS.alreadyConfirmed:
      if (flow === "registration") {
        return "This email address has already been confirmed. Sign in to continue, or contact Candid Creative if your account is still awaiting approval.";
      }

      return "This link has already been used. Sign in to continue.";
    case AUTH_CALLBACK_ERRORS.callbackFailed:
    case AUTH_CALLBACK_ERRORS.inviteAuthError:
      return "We could not complete sign-in from this link. Try again from the latest email, or use the sign-in page.";
    case "invite_callback_failed":
      return "We could not complete your invitation sign-in. Ask your administrator to resend the invite.";
    case "invitation_session_required":
      return "Your password setup session is not active. Open the link from your invitation or reset email, or request a new one.";
    default:
      return null;
  }
}

export function buildAuthErrorPagePath(
  code: AuthCallbackErrorCode,
  flow: AuthCallbackErrorFlow = "general"
) {
  const params = new URLSearchParams({ code });

  if (flow !== "general") {
    params.set("flow", flow);
  }

  return `/auth/error?${params.toString()}`;
}
