export const GMAIL_IMPORT_MAILBOX = "accounts@candidcreative.uk";

export const GMAIL_DISCOVERY_FROM = "2026-07-12";

export const GMAIL_DISCOVERY_TO = "2026-10-12";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const GMAIL_IMPORT_FILES_BUCKET = "gmail-import-files";

export const GMAIL_MAX_FILE_BYTES = 15 * 1024 * 1024;

export const GMAIL_DISCOVERY_BATCH_SIZE = 4;

export const GMAIL_CRON_MAX_BATCHES = 6;

export const GMAIL_CRON_BUDGET_MS = 45_000;

/** Phase 1 backfill only. Ongoing discovery must stay off until it is approved. */
export const GMAIL_ONGOING_SYNC_ENABLED = false;

export const GMAIL_SYNC_OVERLAP_MINUTES = 180;

export function gmailCredentialsConfigured() {
  return Boolean(
    process.env.GMAIL_CLIENT_ID?.trim() &&
      process.env.GMAIL_CLIENT_SECRET?.trim() &&
      process.env.GMAIL_TOKEN_KEY?.trim() &&
      process.env.NEXT_PUBLIC_APP_URL?.trim()
  );
}

export function missingGmailEnv() {
  const names: Array<[string, string | undefined]> = [
    ["GMAIL_CLIENT_ID", process.env.GMAIL_CLIENT_ID],
    ["GMAIL_CLIENT_SECRET", process.env.GMAIL_CLIENT_SECRET],
    ["GMAIL_TOKEN_KEY", process.env.GMAIL_TOKEN_KEY],
    ["NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL],
  ];

  return names.filter(([, value]) => !value?.trim()).map(([name]) => name);
}
