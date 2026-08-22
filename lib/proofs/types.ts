import type {
  ProofArtworkOrigin,
  ProofFileLocationType,
  ProofFileRole,
  ProofInternalChecklistKey,
  ProofStatus,
  ProofWorkflowStatus,
} from "@/lib/proofs/constants";

export type JobProofRecord = {
  id: string;
  job_id: string;
  company_id: string;
  proof_reference: string;
  version_number: number;
  status: ProofStatus;
  title: string;
  artwork_origin: ProofArtworkOrigin;
  customer_message: string | null;
  internal_note: string | null;
  created_by_profile_id: string | null;
  sent_by_profile_id: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  approved_at: string | null;
  approved_by_profile_id: string | null;
  changes_requested_at: string | null;
  changes_requested_comment: string | null;
  changes_requested_by_profile_id: string | null;
  superseded_at: string | null;
  cancelled_at: string | null;
  internal_review_at: string | null;
  internal_review_by_profile_id: string | null;
  ready_to_send_at: string | null;
  ready_to_send_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

export type JobProofFileRecord = {
  id: string;
  proof_id: string;
  file_role: ProofFileRole;
  job_file_id: string | null;
  dropbox_file_id: string | null;
  dropbox_path: string | null;
  dropbox_revision: string | null;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number;
  content_hash: string | null;
  preview_dropbox_path: string | null;
  preview_metadata: Record<string, unknown> | null;
  created_at: string;
};

export type ProofInternalChecklist = Partial<Record<ProofInternalChecklistKey, boolean>>;

export type JobProofFileView = JobProofFileRecord & {
  location_type: ProofFileLocationType | null;
  is_customer_facing: boolean;
};

export type JobProofView = JobProofRecord & {
  files: JobProofFileView[];
  brandedPdfGeneratedAt: string | null;
  manifestItems: Array<{
    id: string;
    item_reference: string | null;
    item_name: string;
    quantity: number | null;
    width_mm: number | null;
    height_mm: number | null;
  }>;
};

export type JobProofRequirementState = {
  proofRequired: boolean;
  workflowStatus: ProofWorkflowStatus;
  workflowLabel: string;
  bypassReason: string | null;
  bypassedAt: string | null;
  proofApprovedAt: string | null;
};

export type AttachProofFileInput = {
  source: "customer_artwork" | "working_file" | "proofs_folder";
  sourceJobFileId?: string | null;
  dropboxSourcePath?: string | null;
};

export type CreateProofInput = {
  title: string;
  artworkOrigin: ProofArtworkOrigin;
  customerMessage?: string | null;
  internalNote?: string | null;
  productionItemIds: string[];
  sourceJobFileId?: string | null;
  dropboxSourcePath?: string | null;
  dropboxFileName?: string | null;
};
