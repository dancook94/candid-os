type AccountBadgeStatus =
  | "pending"
  | "approved"
  | "disabled"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

export function getCustomerPortalStatusSubtitle(
  accountStatus: string | null | undefined
) {
  switch (accountStatus) {
    case "approved":
      return "Company approved";
    case "pending":
      return "Company awaiting approval";
    case "rejected":
    case "disabled":
      return "Account requires attention";
    default:
      return "Company awaiting approval";
  }
}

export function getCustomerAccountStatusBadge(accountStatus: string): {
  status: AccountBadgeStatus;
  label: string;
} {
  switch (accountStatus) {
    case "approved":
      return { status: "approved", label: "Approved" };
    case "pending":
      return { status: "pending", label: "Pending Approval" };
    case "rejected":
      return { status: "declined", label: "Rejected" };
    case "disabled":
      return { status: "disabled", label: "Disabled" };
    default:
      return { status: "pending", label: "Pending Approval" };
  }
}

export function getCustomerAccountStatusDescription(
  accountStatus: string | null | undefined
) {
  switch (accountStatus) {
    case "approved":
      return "Your company access is active.";
    case "disabled":
      return "Your account access is currently disabled.";
    case "rejected":
      return "Your account requires attention from Candid Creative.";
    case "pending":
    default:
      return "Candid will confirm your company access.";
  }
}
