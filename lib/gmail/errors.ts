export type GmailRequestError = Error & {
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
};

const LEAKED_TOKEN_PATTERN = /\b(ya29\.[a-zA-Z0-9._-]{10,}|1\/\/[a-zA-Z0-9_-]{20,})\b/;

export function gmailOAuthUserMessage(input: { message: string; code?: string | null }) {
  const message = input.message.trim();
  const code = input.code?.trim() || null;

  if (
    code === "invalid_client" ||
    /client secret is invalid/i.test(message) ||
    /oauth client was not found/i.test(message)
  ) {
    return "Google rejected the OAuth client ID or secret. In Vercel candid-os-test (Production only), GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must come from the same Google Cloud Web application client, with no surrounding quotes, then redeploy.";
  }

  if (code === "redirect_uri_mismatch") {
    return "The OAuth redirect URI does not match Google Cloud. Copy the redirect URI shown on this page into the same Web client.";
  }

  if (code === "invalid_grant") {
    return "Google rejected the authorization grant. Disconnect any old Gmail link, then connect again so Google issues a new refresh token.";
  }

  if (code === "access_denied") {
    return "Google sign-in was cancelled or access was denied.";
  }

  if (LEAKED_TOKEN_PATTERN.test(message)) {
    return "Gmail authorization failed.";
  }

  return message.slice(0, 300);
}

export function sanitizeGmailError(error: unknown, oauthErrorCode?: string | null) {
  const message = error instanceof Error ? error.message : "Gmail could not be reached.";
  const code =
    oauthErrorCode ??
    (typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : null);

  return gmailOAuthUserMessage({ message, code: code || null });
}

export function gmailErrorStatus(error: unknown) {
  if (typeof error === "object" && error && "status" in error) {
    const status = Number((error as { status?: number }).status);
    return Number.isFinite(status) ? status : undefined;
  }

  return undefined;
}

export function gmailErrorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    return String((error as { code?: string }).code ?? "");
  }

  return "";
}

export function isGmailRateLimit(error: unknown) {
  return gmailErrorStatus(error) === 429;
}

export function isGmailAuthFailure(error: unknown) {
  const status = gmailErrorStatus(error);
  return status === 401 || status === 403 || gmailErrorCode(error) === "invalid_grant";
}

export function gmailRetryAfterSeconds(error: unknown) {
  if (!isGmailRateLimit(error) || typeof error !== "object" || !error) {
    return 15;
  }

  const retryAfter = Number((error as { retryAfterSeconds?: number }).retryAfterSeconds);
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
    return 15;
  }

  return Math.min(Math.ceil(retryAfter), 60);
}
