const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertIsoDate(value: string) {
  const match = ISO_DATE.exec(value);

  if (!match) {
    throw new Error("Use a YYYY-MM-DD date.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Use a real calendar date.");
  }

  return value;
}

export function shiftIsoDate(isoDate: string, days: number) {
  const verified = assertIsoDate(isoDate);
  const [year, month, day] = verified.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Inbox, Archive and Sent are included by searching all mail except Spam,
 * Trash, drafts and chats. Gmail has no in:archive operator; archived mail is
 * what remains after those folders are excluded.
 * after: and before: are exclusive, so the dates are shifted by one day.
 */
export function buildGmailDiscoveryQuery(dateFrom: string, dateTo: string) {
  const from = assertIsoDate(dateFrom);
  const to = assertIsoDate(dateTo);

  if (from > to) {
    throw new Error("The start date must be on or before the end date.");
  }

  const after = shiftIsoDate(from, -1).replaceAll("-", "/");
  const before = shiftIsoDate(to, 1).replaceAll("-", "/");

  return [
    "-in:spam",
    "-in:trash",
    "-in:drafts",
    "-in:chats",
    "has:attachment",
    "(filename:pdf OR filename:jpg OR filename:jpeg OR filename:png)",
    `after:${after}`,
    `before:${before}`,
  ].join(" ");
}
