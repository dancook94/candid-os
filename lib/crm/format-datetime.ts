export function formatCrmDate(dateString: string | null | undefined) {
  if (!dateString) {
    return "—";
  }

  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatCrmDateTime(dateString: string | null | undefined) {
  if (!dateString) {
    return "—";
  }

  return new Date(dateString).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toDateInputValue(dateString: string | null | undefined) {
  if (!dateString) {
    return "";
  }

  return dateString.slice(0, 10);
}

export function toDateTimeLocalValue(dateString: string | null | undefined) {
  if (!dateString) {
    return "";
  }

  const date = new Date(dateString);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function parseDateInputValue(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

export function parseDateTimeLocalValue(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return new Date(trimmed).toISOString();
}
