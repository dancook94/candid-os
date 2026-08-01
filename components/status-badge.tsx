import { cn } from "@/lib/utils";

type Status =
  | "pending"
  | "approved"
  | "disabled"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

type StatusBadgeProps = {
  status: Status;
  label?: string;
  className?: string;
};

const statusStyles: Record<Status, string> = {
  pending: "bg-amber-50 text-amber-800 ring-1 ring-amber-600/15",
  approved: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/15",
  disabled: "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-500/15",
  draft: "bg-neutral-50 text-neutral-700 ring-1 ring-neutral-400/20",
  sent: "bg-sky-50 text-sky-800 ring-1 ring-sky-600/15",
  accepted: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/15",
  declined: "bg-red-50 text-red-800 ring-1 ring-red-600/15",
};

const statusDots: Record<Status, string> = {
  pending: "bg-amber-500",
  approved: "bg-emerald-500",
  disabled: "bg-neutral-400",
  draft: "bg-neutral-400",
  sent: "bg-sky-500",
  accepted: "bg-emerald-500",
  declined: "bg-red-500",
};

const defaultLabels: Record<Status, string> = {
  pending: "Pending",
  approved: "Approved",
  disabled: "Disabled",
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        statusStyles[status],
        className
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDots[status])}
        aria-hidden
      />
      {label ?? defaultLabels[status]}
    </span>
  );
}
