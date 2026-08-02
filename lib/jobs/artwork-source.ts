import type { JobArtworkSource, JobRecord } from "@/lib/jobs/types";
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

export function isJobArtworkSource(value: string): value is JobArtworkSource {
  return (JOB_ARTWORK_SOURCES as readonly string[]).includes(value);
}

export function getAdminArtworkSourceLabel(source: JobArtworkSource) {
  return ADMIN_ARTWORK_SOURCE_LABELS[source] ?? source;
}

export function getAdminArtworkSourceShortLabel(source: JobArtworkSource) {
  return ADMIN_ARTWORK_SOURCE_SHORT_LABELS[source] ?? source;
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
