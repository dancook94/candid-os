export function formatLeaveKindLabel(leaveKind: string) {
  if (leaveKind === "additional_paid") {
    return "Additional paid leave";
  }

  if (leaveKind === "annual") {
    return "Annual leave";
  }

  return leaveKind.replaceAll("_", " ");
}

export function formatUkDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-");

  if (!year || !month || !day) {
    return isoDate;
  }

  return `${day}/${month}/${year}`;
}

export function formatLeaveDateRange(startDate: string, endDate: string) {
  if (startDate === endDate) {
    return formatUkDate(startDate);
  }

  return `${formatUkDate(startDate)} – ${formatUkDate(endDate)}`;
}

export function formatDaysRequested(days: number | string) {
  const value = typeof days === "number" ? days : Number(days);

  if (!Number.isFinite(value)) {
    return String(days);
  }

  if (value === 1) {
    return "1 day";
  }

  return `${value} days`;
}
