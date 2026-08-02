import {
  getCustomerArtworkSourceMessage,
  isCustomerArtworkUploadEnabled,
  resolveCustomerStatusLabelForArtworkSource,
} from "@/lib/jobs/artwork-source";
import { JOB_STATUS_LABELS } from "@/lib/jobs/constants";
import type { JobFileRecord, JobRecord } from "@/lib/jobs/types";
import {
  getCurrentArtworkFile,
  jobHasCompletedArtworkUpload,
  resolveJobStatusView,
  type JobStatusView,
} from "@/lib/jobs/status";

export type CustomerJobStatusView = JobStatusView;

export { getCurrentArtworkFile, jobHasCompletedArtworkUpload, resolveJobStatusView };

export function jobNeedsArtworkUpload(
  job: Pick<JobRecord, "artwork_required" | "status" | "artwork_source">,
  files: JobFileRecord[]
) {
  if (!job.artwork_required) {
    return false;
  }

  if (job.artwork_source === "candid_creating" || job.artwork_source === "manual_receipt") {
    return false;
  }

  if (job.status === "artwork_uploaded" || job.status === "in_production") {
    const currentFile = getCurrentArtworkFile(files);
    return currentFile?.artwork_status === "changes_required";
  }

  const currentFile = getCurrentArtworkFile(files);

  if (!currentFile) {
    return true;
  }

  return currentFile.artwork_status === "changes_required";
}

export function resolveCustomerJobStatus(
  job: JobRecord,
  files: JobFileRecord[] = []
): CustomerJobStatusView {
  const baseView = resolveJobStatusView(job, files);
  const currentFile = getCurrentArtworkFile(files);

  if (
    currentFile &&
    (currentFile.artwork_status === "under_review" ||
      currentFile.artwork_status === "changes_required" ||
      currentFile.artwork_status === "approved")
  ) {
    return baseView;
  }

  const sourceLabel = resolveCustomerStatusLabelForArtworkSource(job);

  if (sourceLabel) {
    return {
      status: job.status,
      statusLabel: sourceLabel,
    };
  }

  return baseView;
}

export {
  getCustomerArtworkSourceMessage,
  isCustomerArtworkUploadEnabled,
};

export function getCustomerChangesRequiredComment(files: JobFileRecord[]) {
  const currentFile = getCurrentArtworkFile(files);

  if (currentFile?.artwork_status === "changes_required") {
    return currentFile.changes_required_comment;
  }

  return null;
}

export function getJobStatusLabel(status: string) {
  return JOB_STATUS_LABELS[status] ?? status;
}
