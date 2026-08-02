const LONDON_TIME_ZONE = "Europe/London";

function getTimeZoneOffsetMs(timeZone: string, date: Date) {
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const zoneDate = new Date(date.toLocaleString("en-US", { timeZone }));
  return utcDate.getTime() - zoneDate.getTime();
}

export function getLondonDayBoundsForDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offset = getTimeZoneOffsetMs(LONDON_TIME_ZONE, new Date(utcMidnight));
  const startMs = utcMidnight + offset;
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;

  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

export function getLondonDayBounds(reference = new Date()) {
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);

  return getLondonDayBoundsForDateKey(dateKey);
}

export function getLondonMonthBounds(reference = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(reference);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const startKey = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endKey = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  return {
    start: getLondonDayBoundsForDateKey(startKey).start,
    end: getLondonDayBoundsForDateKey(endKey).end,
  };
}

export function getLondonDateRangeBounds(fromDate: string, toDate: string) {
  return {
    start: getLondonDayBoundsForDateKey(fromDate).start,
    end: getLondonDayBoundsForDateKey(toDate).end,
  };
}
