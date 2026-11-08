export const GMAIL_IMPORT_MAILBOX = "accounts@candidcreative.uk";

/** Completed phase-1 discovery. Omitted dates still use this window. */
export const GMAIL_DISCOVERY_FROM = "2026-07-12";

export const GMAIL_DISCOVERY_TO = "2026-10-12";

/**
 * Historical window requested for the next discovery run.
 * A caller must choose it. Discovery does not start from these dates on its own.
 * GMAIL_HISTORICAL_DISCOVERY_FROM and GMAIL_HISTORICAL_DISCOVERY_TO can replace them.
 */
export const GMAIL_HISTORICAL_DISCOVERY_FROM = "2026-04-26";

export const GMAIL_HISTORICAL_DISCOVERY_TO = "2026-10-26";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const GMAIL_IMPORT_FILES_BUCKET = "gmail-import-files";

export const GMAIL_MAX_FILE_BYTES = 15 * 1024 * 1024;

export const GMAIL_DISCOVERY_BATCH_SIZE = 4;

export const GMAIL_CRON_MAX_BATCHES = 6;

export const GMAIL_CRON_BUDGET_MS = 45_000;

/** Phase 1 backfill only. Ongoing discovery must stay off until it is approved. */
export const GMAIL_ONGOING_SYNC_ENABLED = false;

export const GMAIL_SYNC_OVERLAP_MINUTES = 180;

export function normalizeOAuthEnvValue(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  let normalized = value.replace(/^\uFEFF/, "").trim();

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized || undefined;
}

export function gmailClientIdLooksValid(clientId: string) {
  return /\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(clientId);
}

export function getGmailOAuthConfig() {
  const clientId = normalizeOAuthEnvValue(process.env.GMAIL_CLIENT_ID);
  const clientSecret = normalizeOAuthEnvValue(process.env.GMAIL_CLIENT_SECRET);
  const appUrl = normalizeOAuthEnvValue(process.env.NEXT_PUBLIC_APP_URL)?.replace(/\/+$/, "");

  return {
    clientId: clientId ?? null,
    clientSecret: clientSecret ?? null,
    redirectUri: appUrl
      ? `${appUrl}/api/admin/materials/invoices/gmail/callback`
      : null,
  };
}

export function gmailCredentialsConfigured() {
  const oauth = getGmailOAuthConfig();

  return Boolean(
    oauth.clientId &&
      oauth.clientSecret &&
      normalizeOAuthEnvValue(process.env.GMAIL_TOKEN_KEY) &&
      oauth.redirectUri
  );
}

export function missingGmailEnv() {
  const oauth = getGmailOAuthConfig();
  const names: Array<[string, string | undefined]> = [
    ["GMAIL_CLIENT_ID", oauth.clientId ?? undefined],
    ["GMAIL_CLIENT_SECRET", oauth.clientSecret ?? undefined],
    ["GMAIL_TOKEN_KEY", normalizeOAuthEnvValue(process.env.GMAIL_TOKEN_KEY)],
    ["NEXT_PUBLIC_APP_URL", normalizeOAuthEnvValue(process.env.NEXT_PUBLIC_APP_URL)],
  ];

  return names.filter(([, value]) => !value?.trim()).map(([name]) => name);
}
