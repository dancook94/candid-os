export const PROOF_STATUSES = [
  "draft",
  "internal_review",
  "ready_to_send",
  "sent",
  "viewed",
  "changes_requested",
  "approved",
  "superseded",
  "cancelled",
] as const;

export type ProofStatus = (typeof PROOF_STATUSES)[number];

/** Proof statuses where staff can start the next version from the current proof. */
export const REVISABLE_PROOF_STATUSES = [
  "ready_to_send",
  "sent",
  "viewed",
  "changes_requested",
  "approved",
] as const satisfies readonly ProofStatus[];

export type RevisableProofStatus = (typeof REVISABLE_PROOF_STATUSES)[number];

export const PROOF_WORKFLOW_STATUSES = [
  "not_required",
  "no_proof",
  "draft",
  "internal_review",
  "ready_to_send",
  "awaiting_customer",
  "changes_requested",
  "approved",
] as const;

export type ProofWorkflowStatus = (typeof PROOF_WORKFLOW_STATUSES)[number];

export const PROOF_ARTWORK_ORIGINS = [
  "customer_uploaded",
  "candid_created",
  "existing_repeat",
] as const;

export type ProofArtworkOrigin = (typeof PROOF_ARTWORK_ORIGINS)[number];

export const PROOF_BYPASS_REASONS = [
  "repeat_job_previously_approved",
  "customer_supplied_print_ready",
  "no_visual_proof_required",
  "internal_sample_job",
  "urgent_production",
  "other",
] as const;

export type ProofBypassReason = (typeof PROOF_BYPASS_REASONS)[number];

export const PROOF_BYPASS_REASON_LABELS: Record<ProofBypassReason, string> = {
  repeat_job_previously_approved: "Repeat job / previously approved",
  customer_supplied_print_ready: "Customer supplied print-ready artwork",
  no_visual_proof_required: "No visual proof required",
  internal_sample_job: "Internal/sample job",
  urgent_production: "Urgent production",
  other: "Other",
};

export const PROOF_STATUS_LABELS: Record<ProofStatus, string> = {
  draft: "Draft",
  internal_review: "Internal review",
  ready_to_send: "Ready to send",
  sent: "Sent to customer",
  viewed: "Viewed by customer",
  changes_requested: "Changes requested",
  approved: "Approved",
  superseded: "Superseded",
  cancelled: "Cancelled",
};

export const PROOF_WORKFLOW_STATUS_LABELS: Record<ProofWorkflowStatus, string> = {
  not_required: "Proof not required",
  no_proof: "No proof",
  draft: "Draft",
  internal_review: "Awaiting internal review",
  ready_to_send: "Ready to send",
  awaiting_customer: "Awaiting customer approval",
  changes_requested: "Changes requested",
  approved: "Approved",
};

export const PROOF_ARTWORK_ORIGIN_LABELS: Record<ProofArtworkOrigin, string> = {
  customer_uploaded: "Customer artwork",
  candid_created: "Candid working file",
  existing_repeat: "Existing / repeat",
};

export const PROOF_FILE_LOCATION_TYPES = [
  "customer_artwork",
  "working_file",
  "proofs_folder",
] as const;

export type ProofFileLocationType = (typeof PROOF_FILE_LOCATION_TYPES)[number];

export const PROOF_FILE_LOCATION_LABELS: Record<ProofFileLocationType, string> = {
  customer_artwork: "Customer Artwork",
  working_file: "Working File",
  proofs_folder: "Proofs",
};

export const PROOF_FILE_ROLES = ["source_artwork", "customer_proof"] as const;

export type ProofFileRole = (typeof PROOF_FILE_ROLES)[number];

export const PROOF_FILE_ROLE_LABELS: Record<ProofFileRole, string> = {
  source_artwork: "Source artwork",
  customer_proof: "Customer proof",
};

export const PROOF_ATTACHABLE_STATUSES = [
  "draft",
  "internal_review",
  "ready_to_send",
] as const satisfies readonly ProofStatus[];

export const PROOF_INTERNAL_CHECKLIST_KEYS = [
  "size_checked",
  "quantity_checked",
  "colour_mode_checked",
  "bleed_trim_checked",
  "spelling_content_checked",
  "material_spec_checked",
] as const;

export type ProofInternalChecklistKey = (typeof PROOF_INTERNAL_CHECKLIST_KEYS)[number];

export const PROOF_INTERNAL_CHECKLIST_LABELS: Record<ProofInternalChecklistKey, string> = {
  size_checked: "Size checked",
  quantity_checked: "Quantity checked",
  colour_mode_checked: "Colour mode checked",
  bleed_trim_checked: "Bleed/trim checked",
  spelling_content_checked: "Spelling/content checked",
  material_spec_checked: "Material/specification checked",
};

export const PROOF_CONFIRMATION_TEXT =
  "I confirm that I have checked the artwork, content, dimensions and specification shown in this proof and approve it for production.";

export const PROOF_ACTIVITY_TYPES = {
  proofCreated: "proof_created",
  proofBrandedPdfGenerated: "proof_branded_pdf_generated",
  proofReadyToSend: "proof_ready_to_send",
  proofSent: "proof_sent",
  proofViewed: "proof_viewed",
  proofChangesRequested: "proof_changes_requested",
  proofApproved: "proof_approved",
  proofSuperseded: "proof_superseded",
  proofDiscarded: "proof_discarded",
  proofBypassed: "proof_bypassed",
  proofRequirementChanged: "proof_requirement_changed",
} as const;

export const PROOF_SELECT =
  "id, job_id, company_id, proof_lineage_id, proof_reference, version_number, status, title, artwork_origin, customer_message, internal_note, created_by_profile_id, sent_by_profile_id, sent_at, viewed_at, approved_at, approved_by_profile_id, changes_requested_at, changes_requested_comment, changes_requested_by_profile_id, superseded_at, cancelled_at, internal_review_at, internal_review_by_profile_id, ready_to_send_at, ready_to_send_by_profile_id, created_at, updated_at";

export const PROOF_FILE_SELECT =
  "id, proof_id, file_role, job_file_id, dropbox_file_id, dropbox_path, dropbox_revision, file_name, mime_type, file_size_bytes, content_hash, preview_dropbox_path, preview_metadata, created_at";
