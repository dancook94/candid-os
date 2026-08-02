export function prepareQuoteAcceptedNotification(_input: {
  companyId: string;
  quoteId: string;
  jobId: string;
}) {
  // Hook for future SMTP notifications when quote is accepted.
}

export function prepareJobCreatedNotification(_input: {
  companyId: string;
  quoteId: string;
  jobId: string;
  jobReference: string;
}) {
  // Hook for future SMTP notifications when a job is created.
}

export function prepareArtworkRequestedNotification(_input: {
  companyId: string;
  jobId: string;
  jobReference: string;
}) {
  // Hook for future SMTP notifications when artwork is requested.
}
