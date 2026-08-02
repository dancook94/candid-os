import type { JobUploadStatus } from "@/lib/jobs/types";

const TRANSFER_STATUS_LABELS: Record<JobUploadStatus, string> = {
  pending: "Uploading",
  uploading: "Uploading",
  processing: "Uploading",
  complete: "Uploaded",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function getArtworkTransferStatusLabel(uploadStatus: JobUploadStatus) {
  return TRANSFER_STATUS_LABELS[uploadStatus] ?? uploadStatus;
}

export function mapArtworkTransferStatusToBadge(uploadStatus: JobUploadStatus) {
  switch (uploadStatus) {
    case "complete":
      return "approved" as const;
    case "failed":
      return "declined" as const;
    case "cancelled":
      return "disabled" as const;
    case "pending":
    case "uploading":
    case "processing":
      return "pending" as const;
    default:
      return "draft" as const;
  }
}

export function getArtworkTableStatusLabel(
  uploadStatus: JobUploadStatus,
  artworkStatus: string
) {
  if (uploadStatus !== "complete") {
    return getArtworkTransferStatusLabel(uploadStatus);
  }

  switch (artworkStatus) {
    case "under_review":
      return "Under review";
    case "changes_required":
      return "Changes required";
    case "approved":
      return "Approved";
    case "superseded":
      return "Superseded";
    default:
      return "Uploaded";
  }
}

export function mapArtworkTableStatusToBadge(
  uploadStatus: JobUploadStatus,
  artworkStatus: string
) {
  if (uploadStatus !== "complete") {
    return mapArtworkTransferStatusToBadge(uploadStatus);
  }

  switch (artworkStatus) {
    case "approved":
      return "approved" as const;
    case "changes_required":
      return "declined" as const;
    case "under_review":
      return "pending" as const;
    case "superseded":
      return "disabled" as const;
    default:
      return "approved" as const;
  }
}
