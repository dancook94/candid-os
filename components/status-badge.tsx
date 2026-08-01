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
};

const statusStyles: Record<Status, string> = {
  pending: "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20",
  approved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20",
  disabled: "bg-neutral-100 text-neutral-600 ring-1 ring-neutral-500/20",
  draft: "bg-neutral-50 text-neutral-700 ring-1 ring-neutral-400/30",
  sent: "bg-blue-50 text-blue-700 ring-1 ring-blue-600/20",
  accepted: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20",
  declined: "bg-red-50 text-red-700 ring-1 ring-red-600/20",
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

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status]
      )}
    >
      {label ?? defaultLabels[status]}
    </span>
  );
}
