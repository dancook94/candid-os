import { JOB_STATUS_LABELS } from "@/lib/jobs/constants";
import type { JobFileRecord, JobRecord, JobStatus } from "@/lib/jobs/types";

export type JobStatusView = {
  status: JobStatus | string;
  statusLabel: string;
};

function getActiveArtworkFiles(files: JobFileRecord[]) {
  return files.filter(
    (file) =>
      !file.deleted_at &&
      file.upload_status === "complete" &&
      file.artwork_status !== "superseded"
  );
}

export function getCurrentArtworkFile(files: JobFileRecord[]) {
  const activeFiles = getActiveArtworkFiles(files);

  if (activeFiles.length === 0) {
    return null;
  }

  return activeFiles.reduce((latest, file) =>
    file.version_number > latest.version_number ? file : latest
  );
}

function resolveArtworkReviewLabel(
  jobStatus: string,
  artworkStatus: JobFileRecord["artwork_status"]
): JobStatusView | null {
  switch (artworkStatus) {
    case "under_review":
      return { status: jobStatus, statusLabel: "Under review" };
    case "changes_required":
      return { status: jobStatus, statusLabel: "Changes required" };
    case "approved":
      return { status: jobStatus, statusLabel: "Artwork approved" };
    default:
      return null;
  }
}

export function resolveJobStatusView(
  job: Pick<JobRecord, "status">,
  files: JobFileRecord[] = []
): JobStatusView {
  const currentFile = getCurrentArtworkFile(files);

  if (job.status === "artwork_uploaded") {
    const reviewLabel = currentFile
      ? resolveArtworkReviewLabel(job.status, currentFile.artwork_status)
      : null;

    if (reviewLabel) {
      return reviewLabel;
    }

    return {
      status: job.status,
      statusLabel: JOB_STATUS_LABELS.artwork_uploaded ?? "Artwork uploaded",
    };
  }

  if (job.status !== "awaiting_artwork") {
    return {
      status: job.status,
      statusLabel: JOB_STATUS_LABELS[job.status] ?? job.status,
    };
  }

  if (!currentFile) {
    return {
      status: job.status,
      statusLabel: JOB_STATUS_LABELS.awaiting_artwork ?? "Awaiting artwork",
    };
  }

  const reviewLabel = resolveArtworkReviewLabel(job.status, currentFile.artwork_status);

  if (reviewLabel) {
    return reviewLabel;
  }

  return {
    status: job.status,
    statusLabel: JOB_STATUS_LABELS.artwork_uploaded ?? "Artwork uploaded",
  };
}

export function jobHasCompletedArtworkUpload(files: JobFileRecord[]) {
  return getActiveArtworkFiles(files).length > 0;
}
