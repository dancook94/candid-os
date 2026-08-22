export type EmailMode = "disabled" | "test" | "live";

export type EmailModeInfo = {
  mode: EmailMode;
  testRecipient: string | null;
  isProduction: boolean;
};

function normalizeMode(value: string | undefined): EmailMode | null {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "disabled" || normalized === "test" || normalized === "live") {
    return normalized;
  }

  return null;
}

export function getEmailMode(): EmailModeInfo {
  const isProduction = process.env.NODE_ENV === "production";
  const explicit = normalizeMode(process.env.EMAIL_MODE);

  let mode: EmailMode;

  if (explicit) {
    mode = explicit;
  } else if (isProduction) {
    mode = "live";
  } else {
    mode = "test";
  }

  if (!isProduction && mode === "live" && !explicit) {
    mode = "test";
  }

  const testRecipient = process.env.EMAIL_TEST_RECIPIENT?.trim() || null;

  return {
    mode,
    testRecipient,
    isProduction,
  };
}

export function applyEmailModeRedirect(input: {
  intendedRecipient: string;
  subject: string;
}) {
  const emailMode = getEmailMode();

  if (emailMode.mode === "disabled") {
    return {
      ...emailMode,
      shouldSend: false,
      actualRecipient: input.intendedRecipient,
      subject: input.subject,
      redirected: false,
    };
  }

  if (emailMode.mode === "test") {
    if (!emailMode.testRecipient) {
      return {
        ...emailMode,
        shouldSend: false,
        actualRecipient: input.intendedRecipient,
        subject: input.subject,
        redirected: false,
        missingTestRecipient: true as const,
      };
    }

    return {
      ...emailMode,
      shouldSend: true,
      actualRecipient: emailMode.testRecipient,
      subject: `[TEST — intended for ${input.intendedRecipient}] ${input.subject}`,
      redirected: true,
    };
  }

  return {
    ...emailMode,
    shouldSend: true,
    actualRecipient: input.intendedRecipient,
    subject: input.subject,
    redirected: false,
  };
}
