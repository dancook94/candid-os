/** Notification trigger stubs — email failure must never roll back proof actions. */

function logProofNotificationStub(event: string, input: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.info(`[notifications:proof] ${event}`, input);
  }
}

export function prepareProofReadyNotification(input: {
  companyId: string;
  jobId: string;
  proofId: string;
}) {
  logProofNotificationStub("proof_ready", input);
}

export function prepareProofApprovedNotification(input: {
  companyId: string;
  jobId: string;
  proofId: string;
}) {
  logProofNotificationStub("proof_approved", input);
}

export function prepareProofChangesRequestedNotification(input: {
  companyId: string;
  jobId: string;
  proofId: string;
}) {
  logProofNotificationStub("proof_changes_requested", input);
}
