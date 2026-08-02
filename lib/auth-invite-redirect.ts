/**
 * Supabase invite redirect target for password setup after email acceptance.
 */
export function buildInvitePasswordSetupRedirect(origin: string) {
  return `${origin}/auth/callback?next=/set-password`;
}

export const AUTH_CALLBACK_ERRORS = {
  missingInvitationCode: "missing_invitation_code",
  invitationExpired: "invitation_expired",
  invitationExchangeFailed: "invitation_exchange_failed",
  inviteAuthError: "invite_auth_error",
} as const;

export type AuthCallbackErrorCode =
  (typeof AUTH_CALLBACK_ERRORS)[keyof typeof AUTH_CALLBACK_ERRORS];

export function mapAuthCallbackFailure(error: {
  message?: string;
  code?: string;
} | null | undefined): AuthCallbackErrorCode {
  const message = (error?.message ?? "").toLowerCase();

  if (
    message.includes("expired") ||
    message.includes("invalid") && message.includes("code")
  ) {
    return AUTH_CALLBACK_ERRORS.invitationExpired;
  }

  return AUTH_CALLBACK_ERRORS.invitationExchangeFailed;
}

export function getAuthCallbackErrorMessage(code: string | null | undefined) {
  switch (code) {
    case AUTH_CALLBACK_ERRORS.missingInvitationCode:
      return "This invitation link is missing a verification code. Open the latest invitation email and try again.";
    case AUTH_CALLBACK_ERRORS.invitationExpired:
      return "This invitation link has expired. Ask your administrator to send a new portal invitation.";
    case AUTH_CALLBACK_ERRORS.invitationExchangeFailed:
      return "We could not verify your invitation. Ask your administrator to resend the invite.";
    case AUTH_CALLBACK_ERRORS.inviteAuthError:
      return "The invitation link could not be accepted. Ask your administrator to resend the invite.";
    case "invite_callback_failed":
      return "We could not complete your invitation sign-in. Ask your administrator to resend the invite.";
    case "invitation_session_required":
      return "Your invitation session is not active. Open the invitation email again or ask for a new invite.";
    default:
      return null;
  }
}
