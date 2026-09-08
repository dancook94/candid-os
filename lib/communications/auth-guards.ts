import {
  getCommunicationConfig,
  isInternalEmailAddress,
} from "@/lib/communications/config";
import { isPublicRegistrationEnabled } from "@/lib/auth/public-registration";

export type ExternalAuthBlockReason =
  | "public_registration_disabled"
  | "test_mode_customer_portal_invite_blocked"
  | "test_mode_customer_signup_blocked"
  | "test_mode_customer_password_reset_blocked";

export function getExternalCustomerAuthBlockReason(
  email: string
): ExternalAuthBlockReason | null {
  const config = getCommunicationConfig();

  if (config.mode === "live") {
    return null;
  }

  if (isInternalEmailAddress(email, config.internalDomains)) {
    return null;
  }

  return "test_mode_customer_portal_invite_blocked";
}

export function assertCustomerPortalInviteAllowed(email: string):
  | { ok: true }
  | { ok: false; reason: ExternalAuthBlockReason; message: string } {
  const reason = getExternalCustomerAuthBlockReason(email);

  if (!reason) {
    return { ok: true };
  }

  return {
    ok: false,
    reason,
    message:
      "Customer portal invitations are disabled while Candid OS is in test communication mode. No invitation email was sent to the customer.",
  };
}

export function assertCustomerSelfSignupAllowed(email: string):
  | { ok: true }
  | { ok: false; reason: ExternalAuthBlockReason; message: string } {
  if (!isPublicRegistrationEnabled()) {
    return {
      ok: false,
      reason: "public_registration_disabled",
      message: "Candid OS registration is currently unavailable.",
    };
  }

  const reason = getExternalCustomerAuthBlockReason(email);

  if (!reason) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: "test_mode_customer_signup_blocked",
    message:
      "Customer self-registration is disabled while Candid OS is in test communication mode.",
  };
}

export function assertCustomerPasswordResetAllowed(email: string):
  | { ok: true }
  | { ok: false; reason: ExternalAuthBlockReason; message: string } {
  const reason = getExternalCustomerAuthBlockReason(email);

  if (!reason) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: "test_mode_customer_password_reset_blocked",
    message:
      "Password reset emails to customers are disabled while Candid OS is in test communication mode.",
  };
}
