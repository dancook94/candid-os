import type { SupabaseClient } from "@supabase/supabase-js";

import { isActiveRequiredItem, isRequirementSatisfied } from "@/lib/manifest/readiness";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import { loadJobProofRequired } from "@/lib/jobs/proof-required";
import {
  PROOF_SELECT,
  PROOF_WORKFLOW_STATUS_LABELS,
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

export async function evaluateJobProofGate(
  adminClient: SupabaseClient,
  jobId: string,
  manifestItems: ManifestItemRecord[] = []
): Promise<ProofGateEvaluation> {
  const proofRequired = await loadJobProofRequired(adminClient, jobId);

  const { data: job, error } = await adminClient
    .from("jobs")
    .select(
      "proof_required, proof_workflow_status, proof_approved_at, proof_bypass_reason"
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
      proofStatusLabel: proofRequired ? "Awaiting proof workflow" : "Proof not required",
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

  if (!proofRequired || workflowStatus === "not_required") {
    return {
      schemaAvailable: true,
      proofRequired: false,
      workflowStatus: "not_required",
      proofApproved: true,
      proofBlocked: false,
      proofStatusLabel: "Proof not required",
      uncoveredItemReferences: [],
    };
  }

  if (workflowStatus === "approved" || job.proof_approved_at) {
    const uncovered = await findUncoveredRequiredItems(adminClient, jobId, manifestItems);

    if (uncovered.length === 0) {
      return {
        schemaAvailable: true,
        proofRequired: true,
        workflowStatus: "approved",
        proofApproved: true,
        proofBlocked: false,
        proofStatusLabel: "Proof approved",
        uncoveredItemReferences: [],
      };
    }

    return {
      schemaAvailable: true,
      proofRequired: true,
      workflowStatus,
      proofApproved: false,
      proofBlocked: true,
      proofStatusLabel: `Proof approved · ${uncovered.length} item(s) still uncovered`,
      uncoveredItemReferences: uncovered,
    };
  }

  return {
    schemaAvailable: true,
    proofRequired: true,
    workflowStatus,
    proofApproved: false,
    proofBlocked: true,
    proofStatusLabel:
      PROOF_WORKFLOW_STATUS_LABELS[workflowStatus] ?? "Proof approval required",
    uncoveredItemReferences: [],
  };
}

async function findUncoveredRequiredItems(
  adminClient: SupabaseClient,
  jobId: string,
  manifestItems: ManifestItemRecord[]
) {
  const activeRequired = manifestItems.filter(isActiveRequiredItem);

  if (activeRequired.length === 0) {
    return [];
  }

  const { data: approvedProofs, error: proofsError } = await adminClient
    .from("job_proofs")
    .select("id")
    .eq("job_id", jobId)
    .eq("status", "approved");

  if (proofsError || !approvedProofs?.length) {
    return activeRequired.map((item) => item.item_reference ?? item.item_name);
  }

  const proofIds = approvedProofs.map((proof) => proof.id);

  const { data: links, error: linksError } = await adminClient
    .from("job_proof_manifest_items")
    .select("production_item_id")
    .in("proof_id", proofIds);

  if (linksError) {
    return activeRequired.map((item) => item.item_reference ?? item.item_name);
  }

  const coveredIds = new Set((links ?? []).map((link) => link.production_item_id));

  if (coveredIds.size === 0) {
    // Whole-job proof with no explicit item links covers all items once approved.
    return [];
  }

  return activeRequired
    .filter((item) => !coveredIds.has(item.id))
    .map((item) => item.item_reference ?? item.item_name);
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
      return "awaiting_customer";
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

export { isRequirementSatisfied, isActiveRequiredItem };
