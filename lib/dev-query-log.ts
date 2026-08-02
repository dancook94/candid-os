type DevQueryLogResult = {
  data: unknown;
  error: unknown;
  count?: number | null;
};

export function logDevQuery(label: string, result: DevQueryLogResult) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const rowCount = Array.isArray(result.data)
    ? result.data.length
    : result.data
      ? 1
      : 0;

  console.log(`[quote-detail] ${label}`, {
    rowCount,
    count: result.count ?? null,
    error: result.error ?? null,
    data: result.data,
  });
}
