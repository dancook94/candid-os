/** Default operational go-live for PrintFactory matching (3 September 2026). */
export const PRINTFACTORY_MATCHING_GO_LIVE_DEFAULT = "2026-09-03";

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

export function getPrintfactoryMatchingGoLiveDate(): Date {
  return new Date(`${getPrintfactoryMatchingGoLiveDateString()}T00:00:00.000Z`);
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
