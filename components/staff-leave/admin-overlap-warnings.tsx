import type { OverlapWarning } from "@/lib/staff-leave/overlap";

export function AdminOverlapWarnings({ warnings }: { warnings: OverlapWarning[] }) {
  if (warnings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No overlapping approved or pending leave detected in the current holiday year.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {warnings.map((warning) => (
        <li
          key={warning.isoDate}
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <p className="font-medium">{warning.isoDate}</p>
          <p className="mt-1">
            {warning.requests
              .map((request) => request.fullName ?? "Team member")
              .join(", ")}{" "}
            ({warning.requests.length} people)
          </p>
        </li>
      ))}
    </ul>
  );
}
