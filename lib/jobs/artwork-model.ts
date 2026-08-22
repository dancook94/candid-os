/**
 * Artwork metadata model — Dropbox holds files; Candid OS stores relationships only.
 *
 * Current links:
 * - job_files ↔ jobs (Dropbox path/id on file row)
 * - job_files.uploaded_by_profile_id ↔ profiles (uploader)
 * - jobs.artwork_source ↔ workflow state
 * - jobs.proof_required ↔ future proofing gate (see migration)
 *
 * Future proofing (not implemented):
 * - proof_versions: job_id, job_file_id?, production_item_id?, version_number, status
 * - production_items ↔ job for per-line artwork/proof requirements
 */

import type { JobArtworkSource, JobFileRecord, JobRecord } from "@/lib/jobs/types";

export type ArtworkFileLink = Pick<
  JobFileRecord,
  | "id"
  | "job_id"
  | "file_name"
  | "original_file_name"
  | "dropbox_file_id"
  | "dropbox_path_lower"
  | "upload_status"
  | "artwork_status"
  | "uploaded_at"
  | "uploaded_by_profile_id"
  | "version_number"
  | "supersedes_file_id"
>;

export type JobArtworkContext = Pick<
  JobRecord,
  | "id"
  | "job_reference"
  | "project_name"
  | "company_id"
  | "contact_id"
  | "quote_id"
  | "opportunity_id"
  | "artwork_source"
  | "artwork_required"
  | "proof_required"
  | "status"
>;

export function describeArtworkSource(source: JobArtworkSource) {
  switch (source) {
    case "portal_upload":
      return "Portal upload";
    case "manual_receipt":
      return "Received manually";
    case "candid_creating":
      return "Candid creating";
    case "customer_pending":
      return "Awaiting customer";
    default:
      return source;
  }
}
