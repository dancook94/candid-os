export const JOB_ARTWORK_ALLOWED_EXTENSIONS = [
  "pdf",
  "ai",
  "eps",
  "svg",
  "psd",
  "tif",
  "tiff",
  "jpg",
  "jpeg",
  "png",
  "zip",
] as const;

export const JOB_ARTWORK_BLOCKED_EXTENSIONS = [
  "exe",
  "bat",
  "cmd",
  "js",
  "php",
  "html",
  "htm",
  "sh",
  "bash",
  "ps1",
  "vbs",
  "msi",
  "scr",
] as const;

export const JOB_ARTWORK_ACCEPT = JOB_ARTWORK_ALLOWED_EXTENSIONS.map(
  (extension) => `.${extension}`
).join(",");

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;

export function getJobArtworkMaxBytes() {
  const configured = Number(process.env.JOB_ARTWORK_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_BYTES;
}

export function getJobArtworkChunkBytes() {
  const configured = Number(process.env.JOB_ARTWORK_CHUNK_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_CHUNK_BYTES;
}

export const JOB_STATUS_LABELS: Record<string, string> = {
  awaiting_artwork: "Awaiting artwork",
  in_production: "In production",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const CUSTOMER_ARTWORK_STATUS_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  under_review: "Under review",
  changes_required: "Changes required",
  approved: "Approved",
  superseded: "Superseded",
};

export const JOB_ACTIVITY_TYPES = {
  customerArtworkUploaded: "customer_artwork_uploaded",
  customerArtworkReplaced: "customer_artwork_replaced",
  artworkReviewStarted: "artwork_review_started",
  artworkChangesRequested: "artwork_changes_requested",
  artworkApproved: "artwork_approved",
  artworkUploadFailed: "artwork_upload_failed",
} as const;
