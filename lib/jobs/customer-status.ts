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
  job: Pick<JobRecord, "artwork_required" | "status">,
  files: JobFileRecord[]
) {
  if (!job.artwork_required) {
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
  return resolveJobStatusView(job, files);
}

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
