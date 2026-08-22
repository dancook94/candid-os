import { Resend } from "resend";

import { getResendConfigStatus } from "@/lib/notifications/config";
import { applyEmailModeRedirect } from "@/lib/notifications/email-mode";
import { getFromHeader, getPlainTextFromHtml } from "@/lib/notifications/templates";

export type SendEmailInput = {
  intendedRecipient: string;
  subject: string;
  html: string;
};

export type SendEmailResult =
  | {
      ok: true;
      status: "sent" | "suppressed" | "skipped";
      actualRecipient: string;
      intendedRecipient: string;
      subject: string;
      providerMessageId: string | null;
      redirected: boolean;
      reason?: string;
    }
  | {
      ok: false;
      status: "failed";
      errorCode:
        | "resend_not_configured"
        | "email_disabled"
        | "missing_test_recipient"
        | "invalid_recipient"
        | "provider_request_failed"
        | "provider_rejection";
      error: string;
      actualRecipient?: string;
      intendedRecipient: string;
      subject: string;
    };

let resendClient: Resend | null = null;

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }

  return resendClient;
}

export async function sendEmailThroughResend(
  input: SendEmailInput
): Promise<SendEmailResult> {
  const intendedRecipient = input.intendedRecipient.trim().toLowerCase();

  if (!intendedRecipient.includes("@")) {
    return {
      ok: false,
      status: "failed",
      errorCode: "invalid_recipient",
      error: "Missing or invalid recipient email.",
      intendedRecipient,
      subject: input.subject,
    };
  }

  const redirect = applyEmailModeRedirect({
    intendedRecipient,
    subject: input.subject,
  });

  if (redirect.mode === "disabled") {
    return {
      ok: true,
      status: "suppressed",
      actualRecipient: intendedRecipient,
      intendedRecipient,
      subject: input.subject,
      providerMessageId: null,
      redirected: false,
      reason: "email_disabled",
    };
  }

  if ("missingTestRecipient" in redirect && redirect.missingTestRecipient) {
    return {
      ok: false,
      status: "failed",
      errorCode: "missing_test_recipient",
      error: "EMAIL_MODE=test requires EMAIL_TEST_RECIPIENT.",
      intendedRecipient,
      subject: input.subject,
    };
  }

  if (!redirect.shouldSend) {
    return {
      ok: true,
      status: "skipped",
      actualRecipient: redirect.actualRecipient,
      intendedRecipient,
      subject: redirect.subject,
      providerMessageId: null,
      redirected: redirect.redirected,
      reason: "email_mode_skip",
    };
  }

  const config = getResendConfigStatus();

  if (!config.configured) {
    return {
      ok: false,
      status: "failed",
      errorCode: "resend_not_configured",
      error: `Resend is not configured. Missing: ${config.missing.join(", ")}`,
      intendedRecipient,
      subject: redirect.subject,
    };
  }

  const client = getResendClient();

  if (!client) {
    return {
      ok: false,
      status: "failed",
      errorCode: "resend_not_configured",
      error: "Resend client unavailable.",
      intendedRecipient,
      subject: redirect.subject,
    };
  }

  try {
    const response = await client.emails.send({
      from: getFromHeader(),
      to: redirect.actualRecipient,
      subject: redirect.subject,
      html: input.html,
      text: getPlainTextFromHtml(input.html),
    });

    if (response.error) {
      return {
        ok: false,
        status: "failed",
        errorCode: "provider_rejection",
        error: response.error.message,
        actualRecipient: redirect.actualRecipient,
        intendedRecipient,
        subject: redirect.subject,
      };
    }

    return {
      ok: true,
      status: "sent",
      actualRecipient: redirect.actualRecipient,
      intendedRecipient,
      subject: redirect.subject,
      providerMessageId: response.data?.id ?? null,
      redirected: redirect.redirected,
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      errorCode: "provider_request_failed",
      error: error instanceof Error ? error.message : "Resend request failed.",
      actualRecipient: redirect.actualRecipient,
      intendedRecipient,
      subject: redirect.subject,
    };
  }
}
