export type ContactPortalStatus =
  | "not_invited"
  | "invitation_sent"
  | "approved"
  | "pending"
  | "disabled";

export const CONTACT_PORTAL_STATUS_LABELS: Record<ContactPortalStatus, string> =
  {
    not_invited: "Not invited",
    invitation_sent: "Invitation sent",
    approved: "Approved",
    pending: "Pending",
    disabled: "Disabled",
  };

export function resolveContactPortalStatus(
  profileId: string | null | undefined,
  accountStatus: string | null | undefined,
  invitedAt: string | null | undefined
): ContactPortalStatus {
  if (!profileId) {
    if (invitedAt) {
      return "invitation_sent";
    }

    return "not_invited";
  }

  if (accountStatus === "approved") {
    return "approved";
  }

  if (accountStatus === "pending") {
    return "pending";
  }

  if (accountStatus === "disabled") {
    return "disabled";
  }

  return "pending";
}

export function getContactPortalStatusLabel(status: ContactPortalStatus) {
  return CONTACT_PORTAL_STATUS_LABELS[status];
}
