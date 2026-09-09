export const JOB_STATUSES = [
  "awaiting_artwork",
  "artwork_in_preparation",
  "artwork_received",
  "in_production",
  "ready",
  "completed",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_ARTWORK_SOURCES = [
  "customer_pending",
  "portal_upload",
  "manual_receipt",
  "candid_creating",
] as const;

export type JobArtworkSource = (typeof JOB_ARTWORK_SOURCES)[number];

export const JOB_UPLOAD_STATUSES = [
  "pending",
  "uploading",
  "processing",
  "complete",
  "failed",
  "cancelled",
] as const;

export type JobUploadStatus = (typeof JOB_UPLOAD_STATUSES)[number];

export const JOB_ARTWORK_STATUSES = [
  "uploaded",
  "under_review",
  "changes_required",
  "approved",
  "superseded",
] as const;

export type JobArtworkStatus = (typeof JOB_ARTWORK_STATUSES)[number];

export const DROPBOX_SETUP_STATUSES = ["pending", "ready", "failed"] as const;

export type DropboxSetupStatus = (typeof DROPBOX_SETUP_STATUSES)[number];

export type JobRecord = {
  id: string;
  company_id: string;
  quote_id: string | null;
  quote_version_id: string | null;
  opportunity_id: string | null;
  quote_request_id: string | null;
  contact_id: string | null;
  job_reference: string;
  project_name: string;
  status: JobStatus;
  fulfilment_method: string | null;
  required_date: string | null;
  artwork_required: boolean;
  artwork_source: JobArtworkSource;
  proof_required?: boolean;
  customer_visible: boolean;
  accepted_at: string | null;
  accepted_by: string | null;
  dropbox_folder_path: string | null;
  dropbox_folder_id: string | null;
  dropbox_setup_status: DropboxSetupStatus;
  slack_channel_id: string | null;
  slack_channel_created_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobFileRecord = {
  id: string;
  job_id: string;
  company_id: string;
  uploaded_by_profile_id: string;
  file_name: string;
  original_file_name: string;
  file_extension: string;
  mime_type: string | null;
  file_size_bytes: number;
  dropbox_file_id: string | null;
  dropbox_path_lower: string | null;
  dropbox_revision: string | null;
  content_hash: string | null;
  dropbox_upload_session_id: string | null;
  upload_session_offset: number | null;
  upload_status: JobUploadStatus;
  artwork_status: JobArtworkStatus;
  customer_notes: string | null;
  internal_notes: string | null;
  version_number: number;
  supersedes_file_id: string | null;
  uploaded_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  approved_by_profile_id: string | null;
  changes_required_comment: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
};

export type CustomerJobFileView = {
  id: string;
  fileName: string;
  originalFileName: string;
  fileSizeBytes: number;
  mimeType: string | null;
  uploadStatus: JobUploadStatus;
  artworkStatus: JobArtworkStatus;
  customerNotes: string | null;
  versionNumber: number;
  uploadedAt: string | null;
  uploadedByName: string | null;
  canRemove: boolean;
  canReplace: boolean;
};

export type CustomerJobDetail = {
  id: string;
  reference: string;
  projectTitle: string;
  status: JobStatus | string;
  statusLabel: string;
  requiredDate: string | null;
  fulfilmentMethod: string | null;
  deliveryDetails: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  quoteLinkPublished: boolean;
  artworkRequired: boolean;
  customerArtworkMessage: string | null;
  uploadEnabled: boolean;
  needsArtworkUpload: boolean;
  changesRequiredComment: string | null;
  dropboxConfigured: boolean;
  files: CustomerJobFileView[];
};
