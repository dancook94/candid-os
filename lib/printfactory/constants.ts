export const PRINTFACTORY_JOB_MATCH_STATUSES = [
  "unmatched",
  "suggested",
  "matched_automatically",
  "matched_manually",
  "ignored",
  "conflict",
] as const;

export type PrintfactoryJobMatchStatus =
  (typeof PRINTFACTORY_JOB_MATCH_STATUSES)[number];

export const PRINTFACTORY_JOB_MATCH_METHODS = [
  "synology_path",
  "source_filename",
  "job_name",
  "document_name",
  "manual",
  "stored_mapping",
  "project_title",
] as const;

export type PrintfactoryJobMatchMethod =
  (typeof PRINTFACTORY_JOB_MATCH_METHODS)[number];

export const PRINTFACTORY_LINK_STATUSES = [
  "suggested",
  "confirmed",
  "rejected",
  "superseded",
] as const;

export type PrintfactoryLinkStatus = (typeof PRINTFACTORY_LINK_STATUSES)[number];

export const MATCH_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

export type MatchConfidenceLevel = (typeof MATCH_CONFIDENCE_LEVELS)[number];

/**
 * PrintFactory job statuses that indicate ripping is complete.
 * Verify against live PrintFactory Cloud API responses for your account.
 * Override via PRINTFACTORY_RIPPED_STATUSES env (comma-separated).
 */
export const DEFAULT_PRINTFACTORY_RIPPED_STATUSES = [
  "ripped",
  "ready",
  "readytoprint",
  "queued",
  "queue",
  "printing",
  "printed",
  "completed",
  "complete",
  "cutting",
  "cut",
  "finishing",
  "finished",
  "released",
] as const;

export const PRINTFACTORY_ACTIVITY_TYPES = {
  syncCompleted: "printfactory_sync_completed",
  jobImported: "printfactory_job_imported",
  jobMatched: "printfactory_job_matched",
  itemLinkSuggested: "printfactory_item_link_suggested",
  itemLinkConfirmed: "printfactory_item_link_confirmed",
  additionalItemCreated: "printfactory_additional_item_created",
} as const;

export const PRINTFACTORY_JOB_SELECT =
  "id, printfactory_job_guid, job_name, source_file_path, normalized_source_path, source_path_status, source_locations, source_file_name, document_name, device, media_type, producer, printfactory_status, progress, created_at_printfactory, updated_at_printfactory, first_seen_at, last_seen_at, candid_job_id, suggested_candid_job_id, job_match_status, job_match_method, job_match_confidence, extracted_job_reference, match_suggestion_reason, match_suggestion_details, ignored_at, ignored_by_profile_id, ignore_reason, created_at, updated_at";

export const PRINTFACTORY_LINK_SELECT =
  "id, printfactory_job_id, production_item_id, link_status, match_method, match_confidence, suggestion_reason, suggestion_details, confirmed_by_profile_id, confirmed_at, created_at, updated_at";
