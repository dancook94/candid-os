import { JOB_STATUS_LABELS } from "@/lib/jobs/constants";
import type { JobFileRecord, JobRecord, JobStatus } from "@/lib/jobs/types";

export type CustomerJobStatusView = {
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

export function jobNeedsArtworkUpload(
  job: Pick<JobRecord, "artwork_required">,
  files: JobFileRecord[]
) {
  if (!job.artwork_required) {
    return false;
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
  if (job.status !== "awaiting_artwork") {
    return {
      status: job.status,
      statusLabel: JOB_STATUS_LABELS[job.status] ?? job.status,
    };
  }

  const currentFile = getCurrentArtworkFile(files);

  if (!currentFile) {
    return {
      status: job.status,
      statusLabel: "Awaiting artwork",
    };
  }

  switch (currentFile.artwork_status) {
    case "under_review":
      return { status: job.status, statusLabel: "Under review" };
    case "changes_required":
      return { status: job.status, statusLabel: "Changes required" };
    case "approved":
      return { status: job.status, statusLabel: "Artwork approved" };
    default:
      return { status: job.status, statusLabel: "Artwork uploaded" };
  }
}

export function getCustomerChangesRequiredComment(files: JobFileRecord[]) {
  const currentFile = getCurrentArtworkFile(files);

  if (currentFile?.artwork_status === "changes_required") {
    return currentFile.changes_required_comment;
  }

  return null;
}
