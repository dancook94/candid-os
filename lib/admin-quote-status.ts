export function formatAdminQuoteStatusLabel(status: string) {
  const labels: Record<string, string> = {
    sent: "Sent",
    accepted: "Accepted",
    declined: "Declined",
    draft: "Draft",
    expired: "Expired",
    superseded: "Superseded",
  };

  return labels[status.toLowerCase()] ?? status;
}
