export const INSTALLATION_PROJECT_STATUSES = [
  "draft",
  "active",
  "completed",
  "cancelled",
] as const;

export type InstallationProjectStatus =
  (typeof INSTALLATION_PROJECT_STATUSES)[number];

export const INSTALLATION_PROJECT_SOURCES = [
  "manual",
  "quote_reconcile",
] as const;

export type InstallationProjectSource =
  (typeof INSTALLATION_PROJECT_SOURCES)[number];

export const INSTALLATION_VISIT_STATUSES = [
  "unscheduled",
  "scheduled",
  "en_route",
  "on_site",
  "completed",
  "cancelled",
  "failed",
] as const;

export type InstallationVisitStatus =
  (typeof INSTALLATION_VISIT_STATUSES)[number];

export const INSTALLATION_DOCUMENT_KINDS = [
  "rams",
  "artwork",
  "drawing",
  "installation_instructions",
  "other",
] as const;

export type InstallationDocumentKind =
  (typeof INSTALLATION_DOCUMENT_KINDS)[number];

export const INSTALLATION_PHOTO_PHASES = ["before", "during", "after"] as const;

export type InstallationPhotoPhase = (typeof INSTALLATION_PHOTO_PHASES)[number];

export const INSTALLATION_SNAG_STATUSES = ["open", "resolved", "wont_fix"] as const;

export type InstallationSnagStatus = (typeof INSTALLATION_SNAG_STATUSES)[number];

export const INSTALLATION_VISIT_EVENT_TYPES = [
  "status_changed",
  "scheduled",
  "assignment_added",
  "assignment_removed",
  "completed",
  "snag_opened",
  "snag_resolved",
  "sign_off_captured",
  "document_added",
  "photo_added",
  "note_added",
  "visit_reopened",
] as const;

export type InstallationVisitEventType =
  (typeof INSTALLATION_VISIT_EVENT_TYPES)[number];

export const INSTALLATION_FILES_BUCKET = "installation-files" as const;

export const INSTALLATION_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const INSTALLATION_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export const INSTALLATION_ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const INSTALLATION_ALLOWED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  ...Array.from(INSTALLATION_ALLOWED_PHOTO_TYPES),
]);
