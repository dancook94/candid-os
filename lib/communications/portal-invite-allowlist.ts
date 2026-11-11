import {
  extractEmailAddress,
  isInternalEmailAddress,
  isTestCommunicationModePublic,
} from "@/lib/communications/config";

const SERVER_ENV_KEY = "CANDID_TEST_PORTAL_INVITE_ALLOWLIST";
const PUBLIC_ENV_KEY = "NEXT_PUBLIC_CANDID_TEST_PORTAL_INVITE_ALLOWLIST";

function parseAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => extractEmailAddress(entry))
    .filter(Boolean);
}

/** Server-side allowlist (Test portal invites only). */
export function getTestPortalInviteAllowlist(): string[] {
  return parseAllowlist(process.env[SERVER_ENV_KEY] ?? process.env[PUBLIC_ENV_KEY]);
}

/** Client-side allowlist mirror for invite UI (set on candid-os-test only). */
export function getTestPortalInviteAllowlistPublic(): string[] {
  return parseAllowlist(process.env[PUBLIC_ENV_KEY]);
}

export function isTestPortalInviteAllowlisted(email: string): boolean {
  const normalized = extractEmailAddress(email);
  if (!normalized) {
    return false;
  }

  return getTestPortalInviteAllowlist().includes(normalized);
}

export function isTestPortalInviteAllowlistedPublic(email: string): boolean {
  const normalized = extractEmailAddress(email);
  if (!normalized) {
    return false;
  }

  return getTestPortalInviteAllowlistPublic().includes(normalized);
}

/**
 * Whether admins may invite this contact email while in public test comms mode.
 * On Live, all valid contact emails are inviteable (API still enforces guards).
 */
export function isCustomerPortalInviteAllowedPublic(email: string | null | undefined): boolean {
  if (!email?.trim()) {
    return false;
  }

  if (!isTestCommunicationModePublic()) {
    return true;
  }

  const normalized = extractEmailAddress(email);
  if (isInternalEmailAddress(normalized)) {
    return true;
  }

  return isTestPortalInviteAllowlistedPublic(normalized);
}
