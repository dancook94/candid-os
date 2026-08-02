import type { JobArtworkSource, JobStatus } from "@/lib/jobs/types";

export const PROTECTED_JOB_STATUSES = [
  "in_production",
  "ready",
  "completed",
  "cancelled",
] as const satisfies readonly JobStatus[];

export const EARLY_ARTWORK_JOB_STATUSES = [
  "awaiting_artwork",
  "artwork_in_preparation",
  "artwork_received",
] as const satisfies readonly JobStatus[];

export function isProtectedJobStatus(status: JobStatus) {
  return (PROTECTED_JOB_STATUSES as readonly string[]).includes(status);
}

export function canArtworkSourceChangeStatus(status: JobStatus) {
  return !isProtectedJobStatus(status);
}

export function resolveJobStatusForArtworkSource(
  artworkSource: JobArtworkSource
): JobStatus {
  switch (artworkSource) {
    case "customer_pending":
      return "awaiting_artwork";
    case "candid_creating":
      return "artwork_in_preparation";
    case "manual_receipt":
    case "portal_upload":
      return "artwork_received";
    default:
      return "awaiting_artwork";
  }
}

export function resolveJobStatusForArtworkSourceChange(
  currentStatus: JobStatus,
  newSource: JobArtworkSource
): JobStatus | undefined {
  if (!canArtworkSourceChangeStatus(currentStatus)) {
    return undefined;
  }

  return resolveJobStatusForArtworkSource(newSource);
}

export function resolveJobStatusAfterPortalUpload(currentStatus: JobStatus) {
  if (currentStatus === "awaiting_artwork") {
    return "artwork_received" as const;
  }

  return undefined;
}

export function getCustomerArtworkStatusMessage(status: JobStatus) {
  switch (status) {
    case "artwork_in_preparation":
      return "Candid Creative is currently preparing artwork for this job.\n\nYou can still upload additional files below if required.";
    case "artwork_received":
      return "We have received artwork for this job.\n\nIf you need to send revised or additional files, you can upload them below.";
    default:
      return null;
  }
}

export function shouldShowArtworkRequiredBanner(status: JobStatus) {
  return status === "awaiting_artwork";
}
