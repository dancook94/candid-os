export type QuoteRequestInboxRow = {
  sourceLabel: "Website" | "Customer portal";
  projectName: string;
  submitterName: string;
  submittedCompanyName: string | null;
  companyLabel: string;
  unlinked: boolean;
  requestStatus: string;
  submittedAt: string;
};

export function quoteRequestSourceLabel(source: string | null | undefined) {
  return source === "website" ? "Website" : "Customer portal";
}

export function buildQuoteRequestInboxRow(input: {
  source: string | null;
  projectName: string;
  submitterName: string | null;
  submitterCompanyName: string | null;
  requesterName: string | null;
  companyId: string | null;
  linkedCompanyName: string | null;
  requestStatus: string;
  createdAt: string;
}): QuoteRequestInboxRow {
  const website = input.source === "website";
  const linkedCompanyName = input.linkedCompanyName?.trim() || null;

  return {
    sourceLabel: quoteRequestSourceLabel(input.source),
    projectName: input.projectName,
    submitterName: website
      ? input.submitterName?.trim() || "Name not supplied"
      : input.requesterName?.trim() || "No portal account",
    submittedCompanyName: website
      ? input.submitterCompanyName?.trim() || null
      : linkedCompanyName,
    companyLabel: input.companyId ? linkedCompanyName || "Unknown company" : "Unlinked",
    unlinked: !input.companyId,
    requestStatus: input.requestStatus,
    submittedAt: input.createdAt,
  };
}

export type WebsiteDetailItem = {
  label: string;
  value: string;
};

export function websiteEnquiryDetailItems(input: {
  submitterName: string | null;
  submitterCompanyName: string | null;
  submitterEmail: string | null;
  submitterPhone: string | null;
  projectName: string;
  description: string;
  requestedDateLabel: string | null;
  requestedTime: string | null;
  projectLocation: string | null;
  existingJobReference: string | null;
  artworkPending: boolean;
  submittedAtLabel: string;
  requestStatusLabel: string;
  linkedCompanyName: string | null;
  companyId: string | null;
}): WebsiteDetailItem[] {
  const items: WebsiteDetailItem[] = [
    { label: "Full name", value: input.submitterName?.trim() || "Name not supplied" },
  ];

  const submittedCompany = input.submitterCompanyName?.trim();

  if (submittedCompany) {
    items.push({ label: "Company entered on the website", value: submittedCompany });
  }

  items.push({ label: "Email", value: input.submitterEmail?.trim() || "Email not supplied" });

  const phone = input.submitterPhone?.trim();

  if (phone) {
    items.push({ label: "Phone", value: phone });
  }

  items.push(
    { label: "Project name", value: input.projectName },
    { label: "Project description", value: input.description }
  );

  if (input.requestedDateLabel) {
    items.push({ label: "Requested date", value: input.requestedDateLabel });
  }

  const requestedTime = input.requestedTime?.trim();

  if (requestedTime) {
    items.push({ label: "Requested time", value: requestedTime });
  }

  const location = input.projectLocation?.trim();

  if (location) {
    items.push({ label: "Project location", value: location });
  }

  const jobReference = input.existingJobReference?.trim();

  if (jobReference) {
    items.push({ label: "Existing Candid job reference", value: jobReference });
  }

  items.push(
    { label: "Artwork pending", value: input.artworkPending ? "Yes" : "No" },
    { label: "Submitted", value: input.submittedAtLabel },
    { label: "Source", value: "Website" },
    { label: "Request status", value: input.requestStatusLabel },
    {
      label: "Linked company",
      value: input.companyId ? input.linkedCompanyName?.trim() || "Unknown company" : "Unlinked",
    }
  );

  return items;
}

export type WebsiteSuggestionSummary = {
  note: string;
  contactName: string | null;
  contactEmail: string | null;
  companyName: string | null;
};

export function websiteSuggestionSummary(input: {
  contactName: string | null;
  contactEmail: string | null;
  companyName: string | null;
} | null): WebsiteSuggestionSummary | null {
  const contactName = input?.contactName?.trim() || null;
  const contactEmail = input?.contactEmail?.trim() || null;
  const companyName = input?.companyName?.trim() || null;

  if (!contactName && !companyName) {
    return null;
  }

  return {
    note: "This suggestion comes from the email address. It is not linked until a member of staff confirms a company and contact.",
    contactName,
    contactEmail,
    companyName,
  };
}
