import type { JobArtworkSource, JobRecord, JobStatus } from "@/lib/jobs/types";
import { JOB_ARTWORK_SOURCES } from "@/lib/jobs/types";

export { JOB_ARTWORK_SOURCES };

export const ADMIN_ARTWORK_SOURCE_LABELS: Record<JobArtworkSource, string> = {
  customer_pending: "Awaiting customer artwork",
  candid_creating: "Candid creating artwork",
  manual_receipt: "Artwork received manually",
  portal_upload: "Artwork uploaded via portal",
};

export const ADMIN_ARTWORK_SOURCE_SHORT_LABELS: Record<JobArtworkSource, string> = {
  customer_pending: "Customer",
  candid_creating: "Candid creating",
  manual_receipt: "Manual",
  portal_upload: "Portal",
};

const LATER_JOB_STATUSES: JobStatus[] = [
  "in_production",
  "ready",
  "completed",
  "cancelled",
];

export function isJobArtworkSource(value: string): value is JobArtworkSource {
  return (JOB_ARTWORK_SOURCES as readonly string[]).includes(value);
}

export function getAdminArtworkSourceLabel(source: JobArtworkSource) {
  return ADMIN_ARTWORK_SOURCE_LABELS[source] ?? source;
}

export function getAdminArtworkSourceShortLabel(source: JobArtworkSource) {
  return ADMIN_ARTWORK_SOURCE_SHORT_LABELS[source] ?? source;
}

export function getCustomerArtworkSourceMessage(source: JobArtworkSource) {
  switch (source) {
    case "candid_creating":
      return "Candid Creative is preparing artwork for this job. You can still upload any additional files below.";
    case "manual_receipt":
      return "Artwork has been received by Candid Creative. You can still upload any additional files below.";
    case "portal_upload":
      return "Artwork has been uploaded. You can upload additional or replacement files below.";
    default:
      return null;
  }
}

export function shouldAutoSetPortalUploadSource(source: JobArtworkSource) {
  return source === "customer_pending";
}

export function isCustomerArtworkUploadEnabled(
  job: Pick<JobRecord, "artwork_required" | "customer_visible" | "status">
) {
  if (!job.artwork_required || !job.customer_visible) {
    return false;
  }

  if (job.status === "completed" || job.status === "cancelled") {
    return false;
  }

  return true;
}

export function resolveJobStatusForArtworkSourceChange(
  currentStatus: JobStatus,
  newSource: JobArtworkSource
): JobStatus | undefined {
  if (LATER_JOB_STATUSES.includes(currentStatus)) {
    return undefined;
  }

  switch (newSource) {
    case "customer_pending":
    case "candid_creating":
      return "awaiting_artwork";
    case "manual_receipt":
    case "portal_upload":
      return "artwork_uploaded";
    default:
      return undefined;
  }
}

export function resolveCustomerStatusLabelForArtworkSource(
  job: Pick<JobRecord, "status" | "artwork_source">
) {
  if (LATER_JOB_STATUSES.includes(job.status)) {
    return null;
  }

  if (job.artwork_source === "candid_creating") {
    return "Artwork in preparation";
  }

  return null;
}
