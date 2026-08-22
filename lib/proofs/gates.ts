import type { SupabaseClient } from "@supabase/supabase-js";

import type { ManifestItemRecord } from "@/lib/manifest/types";
import { loadJobProofRequired } from "@/lib/jobs/proof-required";
import { isJobProofRequired } from "@/lib/proofs/customer-state";
import { deriveCustomerProofState } from "@/lib/proofs/customer-state";
import {
  buildProofCoverageContext,
  findUncoveredRequiredItemReferences,
} from "@/lib/proofs/coverage";
import {
  PROOF_SELECT,
  type ProofWorkflowStatus,
} from "@/lib/proofs/constants";
import { isMissingProofSchemaError } from "@/lib/proofs/errors";
import type { JobProofRecord } from "@/lib/proofs/types";

export type ProofGateEvaluation = {
  schemaAvailable: boolean;
  proofRequired: boolean;
  workflowStatus: ProofWorkflowStatus;
  proofApproved: boolean;
  proofBlocked: boolean;
  proofStatusLabel: string;
  uncoveredItemReferences: string[];
};

async function loadJobProofRecords(adminClient: SupabaseClient, jobId: string) {
  const { data, error } = await adminClient
    .from("job_proofs")
    .select(
      "id, job_id, proof_reference, version_number, status, title, sent_at, changes_requested_comment, approved_at, customer_message, created_at"
    )
    .eq("job_id", jobId)
    .order("version_number", { ascending: false });

  if (error) {
    return [];
  }

  return data ?? [];
}

async function loadApprovedProofManifestLinks(
  adminClient: SupabaseClient,
  approvedProofIds: string[]
) {
  if (approvedProofIds.length === 0) {
    return [];
  }

  const { data, error } = await adminClient
    .from("job_proof_manifest_items")
    .select("proof_id, production_item_id")
    .in("proof_id", approvedProofIds);

  if (error) {
    return [];
  }

  return (data ?? []) as Array<{ proof_id: string; production_item_id: string }>;
}

export async function evaluateJobProofGate(
  adminClient: SupabaseClient,
  jobId: string,
  manifestItems: ManifestItemRecord[] = [],
  jobMeta?: {
    job_reference?: string;
    project_name?: string;
    proof_required?: boolean | null;
  }
): Promise<ProofGateEvaluation> {
  const proofRequired = jobMeta
    ? isJobProofRequired(jobMeta)
    : await loadJobProofRequired(adminClient, jobId);

  const { data: job, error } = await adminClient
    .from("jobs")
    .select(
      "proof_required, proof_workflow_status, proof_approved_at, proof_bypass_reason, job_reference, project_name"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error && isMissingProofSchemaError(error)) {
    return {
      schemaAvailable: false,
      proofRequired,
      workflowStatus: "no_proof",
      proofApproved: !proofRequired,
      proofBlocked: false,
      proofStatusLabel: proofRequired ? "Proof being prepared" : "Proof not required",
      uncoveredItemReferences: [],
    };
  }

  if (error || !job) {
    return {
      schemaAvailable: false,
      proofRequired,
      workflowStatus: "no_proof",
      proofApproved: !proofRequired,
      proofBlocked: false,
      proofStatusLabel: "Unable to evaluate proof gate",
      uncoveredItemReferences: [],
    };
  }

  const workflowStatus = (job.proof_workflow_status ??
    (proofRequired ? "no_proof" : "not_required")) as ProofWorkflowStatus;

  const proofs = await loadJobProofRecords(adminClient, jobId);
  const proofState = deriveCustomerProofState({
    proofRequired,
    proofs,
    jobId,
    jobReference: (job.job_reference as string) ?? jobMeta?.job_reference ?? "",
    projectName: (job.project_name as string) ?? jobMeta?.project_name ?? "",
  });

  if (!proofRequired || workflowStatus === "not_required") {
    return {
      schemaAvailable: true,
      proofRequired: false,
      workflowStatus: "not_required",
      proofApproved: true,
      proofBlocked: false,
      proofStatusLabel: proofState.label,
      uncoveredItemReferences: [],
    };
  }

  const approvedProofIds = proofs
    .filter((proof) => proof.status === "approved")
    .map((proof) => proof.id as string);
  const links = await loadApprovedProofManifestLinks(adminClient, approvedProofIds);
  const coverage = buildProofCoverageContext(proofRequired, approvedProofIds, links);
  const uncovered = findUncoveredRequiredItemReferences(manifestItems, coverage);

  if (proofState.status === "approved" && uncovered.length === 0) {
    return {
      schemaAvailable: true,
      proofRequired: true,
      workflowStatus: "approved",
      proofApproved: true,
      proofBlocked: false,
      proofStatusLabel: proofState.label,
      uncoveredItemReferences: [],
    };
  }

  if (proofState.status === "approved" && uncovered.length > 0) {
    return {
      schemaAvailable: true,
      proofRequired: true,
      workflowStatus,
      proofApproved: false,
      proofBlocked: true,
      proofStatusLabel: `${proofState.label} · ${uncovered.length} item(s) still uncovered`,
      uncoveredItemReferences: uncovered,
    };
  }

  return {
    schemaAvailable: true,
    proofRequired: true,
    workflowStatus,
    proofApproved: false,
    proofBlocked: true,
    proofStatusLabel: proofState.label,
    uncoveredItemReferences: uncovered,
  };
}

export async function syncJobProofWorkflowStatus(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data: latestProof, error } = await adminClient
    .from("job_proofs")
    .select(PROOF_SELECT)
    .eq("job_id", jobId)
    .not("status", "eq", "cancelled")
    .not("status", "eq", "superseded")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return;
  }

  let workflowStatus: ProofWorkflowStatus = "no_proof";

  if (latestProof) {
    workflowStatus = mapProofStatusToWorkflow(latestProof as JobProofRecord);
  }

  const updates: Record<string, unknown> = {
    proof_workflow_status: workflowStatus,
    current_proof_id: latestProof?.id ?? null,
    updated_at: new Date().toISOString(),
  };

  if (latestProof?.status === "approved") {
    updates.proof_approved_at = latestProof.approved_at;
    updates.proof_approved_by_profile_id = latestProof.approved_by_profile_id;
  } else if (workflowStatus !== "approved") {
    updates.proof_approved_at = null;
    updates.proof_approved_by_profile_id = null;
  }

  await adminClient.from("jobs").update(updates).eq("id", jobId);
}

function mapProofStatusToWorkflow(proof: JobProofRecord): ProofWorkflowStatus {
  switch (proof.status) {
    case "draft":
      return "draft";
    case "internal_review":
      return "internal_review";
    case "ready_to_send":
      return "ready_to_send";
    case "sent":
    case "viewed":
      return "awaiting_customer";
    case "changes_requested":
      return "changes_requested";
    case "approved":
      return "approved";
    case "superseded":
      return "no_proof";
    default:
      return "no_proof";
  }
}

export function manifestItemsForProofDisplay(
  items: Array<{
    item_reference: string | null;
    item_name: string;
    quantity: number | null;
    width_mm: number | null;
    height_mm: number | null;
  }>
) {
  return items.map((item) => {
    const dimensions =
      item.width_mm && item.height_mm
        ? `${item.width_mm} × ${item.height_mm} mm`
        : null;

    return {
      label: item.item_reference
        ? `${item.quantity ?? 1} × ${item.item_name}`
        : item.item_name,
      reference: item.item_reference,
      dimensions,
      summary: [
        item.quantity ? `${item.quantity} × ${item.item_name}` : item.item_name,
        dimensions,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

export { isActiveRequiredItem } from "@/lib/manifest/readiness";
export { isRequirementSatisfied } from "@/lib/manifest/readiness";
