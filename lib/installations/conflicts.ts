export type ScheduleConflict = {
  kind: "installation" | "leave" | "absence";
  profile_id?: string;
  profile_name?: string;
  visit_id?: string;
  visit_title?: string;
  project_title?: string;
  scheduled_start_at?: string;
  scheduled_end_at?: string | null;
  start_date?: string;
  end_date?: string;
  day_portion?: string;
};

export function asConflicts(value: unknown): ScheduleConflict[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is ScheduleConflict => {
    return Boolean(item) && typeof item === "object" && "kind" in item;
  });
}

export function conflictSummary(conflict: ScheduleConflict) {
  const name = conflict.profile_name || "Staff";

  if (conflict.kind === "installation") {
    const when = conflict.scheduled_start_at
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(conflict.scheduled_start_at))
      : "another visit";
    return `${name} is already booked on ${conflict.project_title || conflict.visit_title || "an installation"} at ${when}.`;
  }

  const portion =
    conflict.day_portion === "am"
      ? " (morning)"
      : conflict.day_portion === "pm"
        ? " (afternoon)"
        : "";
  const label = conflict.kind === "leave" ? "approved holiday" : "recorded absence";
  const dates =
    conflict.start_date === conflict.end_date
      ? conflict.start_date
      : `${conflict.start_date} to ${conflict.end_date}`;
  return `${name} has ${label}${portion} on ${dates}.`;
}
