import { StatusBadge } from "@/components/status-badge";

export function LeaveStatusBadge({ status }: { status: string }) {
  if (status === "rejected") {
    return <StatusBadge status="declined" label="Declined" />;
  }

  if (status === "cancelled") {
    return <StatusBadge status="disabled" label="Cancelled" />;
  }

  if (
    status === "pending" ||
    status === "approved" ||
    status === "disabled" ||
    status === "draft"
  ) {
    return <StatusBadge status={status} />;
  }

  return <StatusBadge status="disabled" label={status} />;
}
