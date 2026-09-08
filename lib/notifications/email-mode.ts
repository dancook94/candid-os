import {
  getCommunicationConfig,
  type CommunicationMode,
} from "@/lib/communications/config";
import { applyCommunicationSafety } from "@/lib/communications/safety";

/** @deprecated Use CommunicationMode from lib/communications/config */
export type EmailMode = "disabled" | "test" | "live";

export type EmailModeInfo = {
  mode: EmailMode;
  communicationMode: CommunicationMode;
  testRecipient: string | null;
  isProduction: boolean;
};

function mapCommunicationModeToEmailMode(mode: CommunicationMode): EmailMode {
  if (mode === "suppressed") {
    return "disabled";
  }

  return mode;
}

export function getEmailMode(): EmailModeInfo {
  const config = getCommunicationConfig();

  return {
    mode: mapCommunicationModeToEmailMode(config.mode),
    communicationMode: config.mode,
    testRecipient: config.testRecipient,
    isProduction: process.env.NODE_ENV === "production",
  };
}

export function applyEmailModeRedirect(input: {
  intendedRecipient: string;
  subject: string;
  cc?: string[];
  bcc?: string[];
  html?: string;
}) {
  const safety = applyCommunicationSafety({
    intendedRecipient: input.intendedRecipient,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    html: input.html ?? "",
  });

  return {
    mode: mapCommunicationModeToEmailMode(safety.mode),
    communicationMode: safety.mode,
    testRecipient: getCommunicationConfig().testRecipient,
    isProduction: process.env.NODE_ENV === "production",
    shouldSend: safety.shouldSend,
    actualRecipient: safety.actualRecipient,
    actualCc: safety.actualCc,
    actualBcc: safety.actualBcc,
    subject: safety.subject,
    redirected: safety.redirected,
    intendedRecipients: safety.intendedRecipients,
    ...(safety.missingTestRecipient ? { missingTestRecipient: true as const } : {}),
    ...(safety.passthroughInternal ? { passthroughInternal: true as const } : {}),
  };
}
