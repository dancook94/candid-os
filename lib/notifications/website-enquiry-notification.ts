export type WebsiteEnquiryNotificationInput = {
  quoteRequestId: string;
  submitterName: string;
  submitterCompanyName: string | null;
  submitterEmail: string;
  submitterPhone: string | null;
  projectName: string;
  description: string;
  requestedDate: string | null;
};

export function previewWebsiteEnquiryDescription(description: string) {
  const compact = description.trim().replace(/\s+/g, " ");

  if (compact.length <= 280) {
    return compact;
  }

  return `${compact.slice(0, 277)}...`;
}

export function buildWebsiteEnquiryNotificationMetadata(
  input: WebsiteEnquiryNotificationInput
) {
  const preview = previewWebsiteEnquiryDescription(input.description);

  return {
    enquirySource: "website",
    projectName: input.projectName,
    companyName: input.submitterCompanyName?.trim() || "Not provided",
    customerName: input.submitterName,
    email: input.submitterEmail,
    ...(input.submitterPhone?.trim() ? { phone: input.submitterPhone.trim() } : {}),
    ...(preview ? { projectDescription: preview } : {}),
    ...(input.requestedDate ? { requiredDate: input.requestedDate } : {}),
    quoteRequestId: input.quoteRequestId,
    quoteRequestUrl: `/admin/quote-requests/${input.quoteRequestId}`,
  };
}
