/** Default operational go-live for PrintFactory matching (3 September 2026). */
export const PRINTFACTORY_MATCHING_GO_LIVE_DEFAULT = "2026-09-03";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class PrintfactoryGoLiveConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintfactoryGoLiveConfigError";
  }
}

/**
 * Operational cutover for PrintFactory matching and live sync lower bound.
 * Set PRINTFACTORY_MATCHING_GO_LIVE_DATE in Vercel to either:
 *   - YYYY-MM-DD (UTC midnight), or
 *   - a full ISO 8601 timestamp (e.g. 2026-09-08T16:45:00.000Z)
 * so pre-cutover PrintFactory rows remain stored but excluded from the
 * operational queue. Live sync never fetches before this instant.
 */

export type PrintfactoryMatchingDateRecord = {
  created_at_printfactory?: string | null;
  first_seen_at?: string | null;
};

export function getPrintfactoryMatchingGoLiveDateString(): string {
  return (
    process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE?.trim() ||
    PRINTFACTORY_MATCHING_GO_LIVE_DEFAULT
  );
}

export function parsePrintfactoryMatchingGoLiveDate(value: string): Date {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new PrintfactoryGoLiveConfigError(
      "PRINTFACTORY_MATCHING_GO_LIVE_DATE cannot be empty."
    );
  }

  if (DATE_ONLY_PATTERN.test(trimmed)) {
    const date = new Date(`${trimmed}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) {
      throw new PrintfactoryGoLiveConfigError(
        `Invalid PRINTFACTORY_MATCHING_GO_LIVE_DATE "${trimmed}": date-only value is not a valid calendar date.`
      );
    }

    return date;
  }

  if (trimmed.includes("T")) {
    const date = new Date(trimmed);

    if (Number.isNaN(date.getTime())) {
      throw new PrintfactoryGoLiveConfigError(
        `Invalid PRINTFACTORY_MATCHING_GO_LIVE_DATE "${trimmed}": not a valid ISO 8601 timestamp.`
      );
    }

    return date;
  }

  throw new PrintfactoryGoLiveConfigError(
    `Invalid PRINTFACTORY_MATCHING_GO_LIVE_DATE "${trimmed}": use YYYY-MM-DD or a full ISO 8601 timestamp (e.g. 2026-09-08T16:45:00.000Z).`
  );
}

export function getPrintfactoryMatchingGoLiveDate(): Date {
  const raw = process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE?.trim();

  return parsePrintfactoryMatchingGoLiveDate(
    raw || PRINTFACTORY_MATCHING_GO_LIVE_DEFAULT
  );
}

export function getPrintfactoryMatchingGoLiveIso(): string {
  return getPrintfactoryMatchingGoLiveDate().toISOString();
}

function resolvePrintfactoryRecordDate(record: PrintfactoryMatchingDateRecord): Date | null {
  const raw = record.created_at_printfactory ?? record.first_seen_at;

  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isPrintfactoryRecordOnOrAfterGoLive(
  record: PrintfactoryMatchingDateRecord
): boolean {
  const recordDate = resolvePrintfactoryRecordDate(record);

  if (!recordDate) {
    return true;
  }

  return recordDate >= getPrintfactoryMatchingGoLiveDate();
}

export function clampSyncDateTimeFrom(
  dateTimeFrom: string,
  options?: { includeHistorical?: boolean }
): string {
  if (options?.includeHistorical) {
    return dateTimeFrom;
  }

  const goLiveIso = getPrintfactoryMatchingGoLiveIso();
  const from = new Date(dateTimeFrom);
  const goLive = new Date(goLiveIso);

  if (from < goLive) {
    return goLiveIso;
  }

  return dateTimeFrom;
}

export type PrintfactoryMatchingLoadFilters = {
  includeHistorical?: boolean;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export function filterPrintfactoryRecordsByOperationalWindow<
  T extends PrintfactoryMatchingDateRecord,
>(records: T[], filters: PrintfactoryMatchingLoadFilters = {}): T[] {
  const includeHistorical = filters.includeHistorical ?? false;
  const dateFrom = filters.dateFrom?.trim() || null;
  const dateTo = filters.dateTo?.trim() || null;
  const goLive = getPrintfactoryMatchingGoLiveDate();

  return records.filter((record) => {
    const recordDate = resolvePrintfactoryRecordDate(record);

    if (!includeHistorical) {
      if (recordDate && recordDate < goLive) {
        return false;
      }
    }

    if (dateFrom) {
      const from = new Date(`${dateFrom}T00:00:00.000Z`);

      if (recordDate && recordDate < from) {
        return false;
      }
    }

    if (dateTo) {
      const to = new Date(`${dateTo}T23:59:59.999Z`);

      if (recordDate && recordDate > to) {
        return false;
      }
    }

    return true;
  });
}
