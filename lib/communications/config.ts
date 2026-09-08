export type CommunicationMode = "test" | "live" | "suppressed";

export type CommunicationConfig = {
  mode: CommunicationMode;
  testRecipient: string | null;
  internalDomains: string[];
  /** Legacy EMAIL_MODE value when explicitly set */
  legacyEmailMode: "disabled" | "test" | "live" | null;
};

const DEFAULT_INTERNAL_DOMAINS = ["candidcreative.uk", "candidcreative.co.uk"];

function normalizeCommunicationMode(
  value: string | undefined
): CommunicationMode | null {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "test" || normalized === "live") {
    return normalized;
  }

  if (normalized === "disabled" || normalized === "off" || normalized === "suppress") {
    return "suppressed";
  }

  return null;
}

function normalizeLegacyEmailMode(
  value: string | undefined
): "disabled" | "test" | "live" | null {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "disabled" || normalized === "test" || normalized === "live") {
    return normalized;
  }

  return null;
}

function parseInternalDomains(): string[] {
  const configured = process.env.CANDID_INTERNAL_EMAIL_DOMAINS?.trim();

  if (!configured) {
    return [...DEFAULT_INTERNAL_DOMAINS];
  }

  return configured
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

export function extractEmailAddress(value: string): string {
  const trimmed = value.trim();
  const bracketMatch = trimmed.match(/<([^>]+)>/);

  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim().toLowerCase();
  }

  return trimmed.toLowerCase();
}

export function getEmailDomain(email: string): string | null {
  const address = extractEmailAddress(email);
  const atIndex = address.lastIndexOf("@");

  if (atIndex <= 0 || atIndex === address.length - 1) {
    return null;
  }

  return address.slice(atIndex + 1);
}

export function isInternalEmailAddress(
  email: string,
  internalDomains: string[] = parseInternalDomains()
): boolean {
  const domain = getEmailDomain(email);

  if (!domain) {
    return false;
  }

  return internalDomains.includes(domain);
}

/**
 * Fail-safe default: missing or invalid CANDID_COMMUNICATION_MODE behaves as TEST.
 * Live delivery requires an explicit CANDID_COMMUNICATION_MODE=live.
 * Legacy EMAIL_MODE=disabled is an emergency kill switch (more restrictive only).
 */
export function getCommunicationConfig(): CommunicationConfig {
  const candidMode = normalizeCommunicationMode(
    process.env.CANDID_COMMUNICATION_MODE
  );
  const legacyEmailMode = normalizeLegacyEmailMode(process.env.EMAIL_MODE);

  let mode: CommunicationMode;

  if (legacyEmailMode === "disabled") {
    mode = "suppressed";
  } else if (candidMode) {
    mode = candidMode;
  } else {
    mode = "test";
  }

  const testRecipient =
    process.env.CANDID_TEST_EMAIL_RECIPIENT?.trim() ||
    process.env.EMAIL_TEST_RECIPIENT?.trim() ||
    null;

  return {
    mode,
    testRecipient,
    internalDomains: parseInternalDomains(),
    legacyEmailMode,
  };
}

export function isLiveCommunicationMode(): boolean {
  return getCommunicationConfig().mode === "live";
}

export function isTestCommunicationMode(): boolean {
  return getCommunicationConfig().mode === "test";
}

export function isSuppressedCommunicationMode(): boolean {
  return getCommunicationConfig().mode === "suppressed";
}

/** Client-safe mirror — defaults to test when unset (fail-safe). */
export function isTestCommunicationModePublic(): boolean {
  const publicMode = process.env.NEXT_PUBLIC_CANDID_COMMUNICATION_MODE?.trim().toLowerCase();

  if (publicMode === "live") {
    return false;
  }

  if (publicMode === "test" || publicMode === "disabled" || publicMode === "suppressed") {
    return true;
  }

  return true;
}
