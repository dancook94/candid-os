import { Resend } from "resend";

import { applyCommunicationSafety } from "@/lib/communications/safety";
import { getResendConfigStatus } from "@/lib/notifications/config";
import { logNotificationStage } from "@/lib/notifications/debug-log";
import { getFromHeader } from "@/lib/notifications/templates";

export type SendEmailInput = {
  intendedRecipient: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
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
      communicationMode: "test" | "live" | "suppressed";
      intendedRecipients: Array<{ role: "to" | "cc" | "bcc"; address: string }>;
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
      communicationMode: "test" | "live" | "suppressed";
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
      communicationMode: "test",
    };
  }

  const safety = applyCommunicationSafety({
    intendedRecipient,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (safety.mode === "suppressed") {
    return {
      ok: true,
      status: "suppressed",
      actualRecipient: intendedRecipient,
      intendedRecipient,
      subject: input.subject,
      providerMessageId: null,
      redirected: false,
      communicationMode: safety.mode,
      intendedRecipients: safety.intendedRecipients,
      reason: "communication_suppressed",
    };
  }

  if (safety.missingTestRecipient) {
    return {
      ok: false,
      status: "failed",
      errorCode: "missing_test_recipient",
      error:
        "CANDID_COMMUNICATION_MODE=test requires CANDID_TEST_EMAIL_RECIPIENT.",
      intendedRecipient,
      subject: input.subject,
      communicationMode: safety.mode,
    };
  }

  if (!safety.shouldSend) {
    return {
      ok: true,
      status: "skipped",
      actualRecipient: safety.actualRecipient,
      intendedRecipient,
      subject: safety.subject,
      providerMessageId: null,
      redirected: safety.redirected,
      communicationMode: safety.mode,
      intendedRecipients: safety.intendedRecipients,
      reason: "communication_mode_skip",
    };
  }

  const config = getResendConfigStatus();

  logNotificationStage("resend_prepare", {
    intendedRecipient,
    actualRecipient: safety.actualRecipient,
    subject: safety.subject,
    communicationMode: safety.mode,
    redirected: safety.redirected,
    from: `${config.fromName} <${config.fromEmail}>`,
    shouldSend: safety.shouldSend,
    intendedRecipients: safety.intendedRecipients,
  });

  if (!config.configured) {
    return {
      ok: false,
      status: "failed",
      errorCode: "resend_not_configured",
      error: `Resend is not configured. Missing: ${config.missing.join(", ")}`,
      intendedRecipient,
      subject: safety.subject,
      communicationMode: safety.mode,
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
      subject: safety.subject,
      communicationMode: safety.mode,
    };
  }

  try {
    const response = await client.emails.send({
      from: getFromHeader(),
      to: safety.actualRecipient,
      ...(safety.actualCc.length > 0 ? { cc: safety.actualCc } : {}),
      ...(safety.actualBcc.length > 0 ? { bcc: safety.actualBcc } : {}),
      subject: safety.subject,
      html: safety.html,
      text: safety.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });

    if (response.error) {
      return {
        ok: false,
        status: "failed",
        errorCode: "provider_rejection",
        error: response.error.message,
        actualRecipient: safety.actualRecipient,
        intendedRecipient,
        subject: safety.subject,
        communicationMode: safety.mode,
      };
    }

    return {
      ok: true,
      status: "sent",
      actualRecipient: safety.actualRecipient,
      intendedRecipient,
      subject: safety.subject,
      providerMessageId: response.data?.id ?? null,
      redirected: safety.redirected,
      communicationMode: safety.mode,
      intendedRecipients: safety.intendedRecipients,
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      errorCode: "provider_request_failed",
      error: error instanceof Error ? error.message : "Resend request failed.",
      actualRecipient: safety.actualRecipient,
      intendedRecipient,
      subject: safety.subject,
      communicationMode: safety.mode,
    };
  }
}
