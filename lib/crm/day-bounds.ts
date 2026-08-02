const LONDON_TIME_ZONE = "Europe/London";

function getTimeZoneOffsetMs(timeZone: string, date: Date) {
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const zoneDate = new Date(date.toLocaleString("en-US", { timeZone }));
  return utcDate.getTime() - zoneDate.getTime();
}

export function getLondonDayBounds(reference = new Date()) {
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);

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
