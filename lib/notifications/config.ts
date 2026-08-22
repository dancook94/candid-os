import { getEmailMode } from "@/lib/notifications/email-mode";

export type ResendConfigStatus = {
  configured: boolean;
  fromEmail: string;
  fromName: string;
  appUrl: string;
  emailMode: ReturnType<typeof getEmailMode>["mode"];
  developmentSafetyActive: boolean;
  missing: string[];
};

export function getAppBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

export function getResendFromAddress() {
  const fromEmail =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.RESEND_FROM?.trim() ||
    "notifications@candidcreative.uk";

  const fromName =
    process.env.RESEND_FROM_NAME?.trim() || "Candid Creative";

  return { fromEmail, fromName };
}

export function getResendConfigStatus(): ResendConfigStatus {
  const missing: string[] = [];
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const { fromEmail } = getResendFromAddress();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const emailMode = getEmailMode();

  if (!apiKey) {
    missing.push("RESEND_API_KEY");
  }

  if (!appUrl) {
    missing.push("NEXT_PUBLIC_APP_URL");
  }

  const { fromName } = getResendFromAddress();

  return {
    configured: Boolean(apiKey && fromEmail),
    fromEmail,
    fromName,
    appUrl: getAppBaseUrl(),
    emailMode: emailMode.mode,
    developmentSafetyActive: emailMode.mode !== "live",
    missing,
  };
}
