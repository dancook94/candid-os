/**
 * Customer publication is distinct from quote acceptance.
 * A quote version was published to the customer only when sent_at is set by the send workflow.
 */
export function isQuoteVersionCustomerPublished(
  sentAt: string | null | undefined
): boolean {
  return sentAt != null && sentAt !== "";
}

export function isCustomerQuoteAccessible(
  status: string | undefined,
  sentAt: string | null | undefined
): boolean {
  if (!status) {
    return false;
  }

  const normalized = status.toLowerCase();
  const publishedStatuses = [
    "sent",
    "accepted",
    "declined",
    "expired",
    "superseded",
  ];

  return (
    publishedStatuses.includes(normalized) &&
    isQuoteVersionCustomerPublished(sentAt)
  );
}
