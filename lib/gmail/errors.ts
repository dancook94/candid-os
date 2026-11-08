export type GmailRequestError = Error & {
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
};

export function sanitizeGmailError(error: unknown, oauthErrorCode?: string | null) {
  const message = error instanceof Error ? error.message : "Gmail could not be reached.";

  if (/bearer|refresh_token|access_token|client_secret|ciphertext|ya29\.|1\/\//i.test(message)) {
    return "Gmail authorization failed.";
  }

  if (
    oauthErrorCode === "invalid_client" ||
    /client secret is invalid/i.test(message) ||
    /oauth client was not found/i.test(message)
  ) {
    return "Google rejected the OAuth client ID or secret. In Vercel candid-os-test (Production only), GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must come from the same Google Cloud Web application client, with no surrounding quotes, then redeploy.";
  }

  return message.slice(0, 300);
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
