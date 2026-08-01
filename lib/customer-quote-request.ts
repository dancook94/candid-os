export const FORMAL_QUOTE_LOCK_STATUSES = [
  "sent",
  "accepted",
  "declined",
  "expired",
  "superseded",
] as const;

export type FormalQuoteLockStatus = (typeof FORMAL_QUOTE_LOCK_STATUSES)[number];

export const QUOTE_REQUEST_LOCKED_NOTICE =
  "This request is now linked to a formal quote and can no longer be edited.";

export function isCustomerQuoteViewable(status: string | undefined) {
  if (!status) {
    return false;
  }

  return FORMAL_QUOTE_LOCK_STATUSES.includes(
    status.toLowerCase() as FormalQuoteLockStatus
  );
}

export function isQuoteRequestLockedByFormalQuote(
  customerQuoteStatus: string | undefined
) {
  return isCustomerQuoteViewable(customerQuoteStatus);
}

export function getCustomerQuoteActionLabel(status: string | undefined) {
  if (!status) {
    return "No quote yet";
  }

  if (isCustomerQuoteViewable(status)) {
    return "View Quote";
  }

  if (status.toLowerCase() === "draft") {
    return "Preparing quote";
  }

  return "Preparing quote";
}

export function mapCustomerQuoteStatusToBadge(status: string) {
  const badgeMap: Record<
    string,
    "pending" | "sent" | "accepted" | "declined" | "disabled"
  > = {
    draft: "pending",
    sent: "sent",
    accepted: "accepted",
    declined: "declined",
    expired: "disabled",
    superseded: "pending",
  };

  return badgeMap[status.toLowerCase()] ?? "pending";
}
