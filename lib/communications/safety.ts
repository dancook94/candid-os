import {
  extractEmailAddress,
  getCommunicationConfig,
  isInternalEmailAddress,
  type CommunicationMode,
} from "@/lib/communications/config";
import {
  buildTestEmailSubject,
  type IntendedRecipient,
  wrapHtmlWithTestBanner,
  wrapPlainTextWithTestBanner,
} from "@/lib/communications/test-banner";

export type CommunicationSafetyResult = {
  mode: CommunicationMode;
  shouldSend: boolean;
  redirected: boolean;
  actualRecipient: string;
  actualCc: string[];
  actualBcc: string[];
  subject: string;
  html: string;
  text: string;
  intendedRecipients: IntendedRecipient[];
  missingTestRecipient?: true;
  passthroughInternal?: true;
};

function normalizeRecipientList(values: string[] | undefined): string[] {
  if (!values?.length) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const address = extractEmailAddress(value);

    if (!address.includes("@") || seen.has(address)) {
      continue;
    }

    seen.add(address);
    normalized.push(address);
  }

  return normalized;
}

function buildIntendedRecipients(input: {
  to: string;
  cc?: string[];
  bcc?: string[];
}): IntendedRecipient[] {
  const recipients: IntendedRecipient[] = [
    { role: "to", address: extractEmailAddress(input.to) },
  ];

  for (const address of normalizeRecipientList(input.cc)) {
    recipients.push({ role: "cc", address });
  }

  for (const address of normalizeRecipientList(input.bcc)) {
    recipients.push({ role: "bcc", address });
  }

  return recipients;
}

function hasExternalRecipient(
  recipients: IntendedRecipient[],
  internalDomains: string[]
): boolean {
  return recipients.some(
    (recipient) => !isInternalEmailAddress(recipient.address, internalDomains)
  );
}

function formatPlainTextFromHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function applyCommunicationSafety(input: {
  intendedRecipient: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
}): CommunicationSafetyResult {
  const config = getCommunicationConfig();
  const intendedRecipients = buildIntendedRecipients({
    to: input.intendedRecipient,
    cc: input.cc,
    bcc: input.bcc,
  });
  const plainText = input.text ?? formatPlainTextFromHtml(input.html);
  const baseResult = {
    mode: config.mode,
    intendedRecipients,
    actualCc: [] as string[],
    actualBcc: [] as string[],
  };

  if (config.mode === "suppressed") {
    return {
      ...baseResult,
      shouldSend: false,
      redirected: false,
      actualRecipient: extractEmailAddress(input.intendedRecipient),
      subject: input.subject,
      html: input.html,
      text: plainText,
    };
  }

  const externalPresent = hasExternalRecipient(
    intendedRecipients,
    config.internalDomains
  );

  if (config.mode === "live" || !externalPresent) {
    return {
      ...baseResult,
      shouldSend: true,
      redirected: false,
      actualRecipient: extractEmailAddress(input.intendedRecipient),
      actualCc: normalizeRecipientList(input.cc),
      actualBcc: normalizeRecipientList(input.bcc),
      subject: input.subject,
      html: input.html,
      text: plainText,
      passthroughInternal: !externalPresent ? true : undefined,
    };
  }

  if (!config.testRecipient) {
    return {
      ...baseResult,
      shouldSend: false,
      redirected: false,
      actualRecipient: extractEmailAddress(input.intendedRecipient),
      subject: input.subject,
      html: input.html,
      text: plainText,
      missingTestRecipient: true,
    };
  }

  const subject = buildTestEmailSubject(input.subject);
  const html = wrapHtmlWithTestBanner(input.html, intendedRecipients);
  const text = wrapPlainTextWithTestBanner(plainText, intendedRecipients);

  return {
    ...baseResult,
    shouldSend: true,
    redirected: true,
    actualRecipient: config.testRecipient,
    subject,
    html,
    text,
  };
}
