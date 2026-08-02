import { StatusBadge } from "@/components/status-badge";
import {
  getContactPortalStatusLabel,
  type ContactPortalStatus,
} from "@/lib/crm/contact-portal-status";

type ContactPortalStatusBadgeProps = {
  status: ContactPortalStatus;
};

function mapPortalStatusToBadge(
  status: ContactPortalStatus
): "pending" | "approved" | "disabled" | "draft" | "sent" {
  switch (status) {
    case "approved":
      return "approved";
    case "pending":
      return "pending";
    case "disabled":
      return "disabled";
    case "invitation_sent":
      return "sent";
    default:
      return "draft";
  }
}

export function ContactPortalStatusBadge({
  status,
}: ContactPortalStatusBadgeProps) {
  return (
    <StatusBadge
      status={mapPortalStatusToBadge(status)}
      label={getContactPortalStatusLabel(status)}
    />
  );
}
