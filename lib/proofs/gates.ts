import type { SupabaseClient } from "@supabase/supabase-js";

import type { ManifestItemRecord } from "@/lib/manifest/types";
import {
  findPendingProofRequirementReferences,
  findUncoveredProofRequiredItemReferences,
  type ProofRecordForItemCoverage,
} from "@/lib/manifest/proof-requirement";
import { loadJobProofRequired } from "@/lib/jobs/proof-required";
import {
  deriveCustomerProofState,
  isJobProofRequired,
  type CustomerProofSummary,
} from "@/lib/proofs/customer-state";
import {
  buildProofCoverageContext,
  findUncoveredRequiredItemReferences,
} from "@/lib/proofs/coverage";
import { deriveJobProofSummary } from "@/lib/proofs/job-proof-summary";
import {
  PROOF_SELECT,
  PROOF_WORKFLOW_STATUS_LABELS,
  type ProofWorkflowStatus,
} from "@/lib/proofs/constants";
import { isMissingProofSchemaError } from "@/lib/proofs/errors";
import type { JobProofRecord } from "@/lib/proofs/types";
import {
  groupProofsByLineage,
  getCurrentProofInLineage,
} from "@/lib/proofs/versioning";

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
      "id, job_id, proof_lineage_id, proof_reference, version_number, status, title, sent_at, changes_requested_comment, approved_at, customer_message, created_at"
    )
    .eq("job_id", jobId)
    .order("version_number", { ascending: false });

  if (error) {
    return [];
  }

  return data ?? [];
}

async function loadAllProofManifestLinks(
  adminClient: SupabaseClient,
  proofIds: string[]
) {
  if (proofIds.length === 0) {
    return [];
  }

  const { data, error } = await adminClient
    .from("job_proof_manifest_items")
    .select("proof_id, production_item_id")
    .in("proof_id", proofIds);

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
    proof_requirements_confirmed_at?: string | null;
  }
): Promise<ProofGateEvaluation> {
  const legacyProofRequired = jobMeta
    ? isJobProofRequired(jobMeta)
    : await loadJobProofRequired(adminClient, jobId);

  const { data: job, error } = await adminClient
    .from("jobs")
    .select(
      "proof_required, proof_workflow_status, proof_approved_at, proof_bypass_reason, job_reference, project_name, proof_requirements_confirmed_at"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error && isMissingProofSchemaError(error)) {
    return {
      schemaAvailable: false,
      proofRequired: legacyProofRequired,
      workflowStatus: "no_proof",
      proofApproved: !legacyProofRequired,
      proofBlocked: false,
      proofStatusLabel: legacyProofRequired ? "Proof being prepared" : "Proof not required",
      uncoveredItemReferences: [],
    };
  }

  if (error || !job) {
    return {
      schemaAvailable: false,
      proofRequired: legacyProofRequired,
      workflowStatus: "no_proof",
      proofApproved: !legacyProofRequired,
      proofBlocked: false,
      proofStatusLabel: "Unable to evaluate proof gate",
      uncoveredItemReferences: [],
    };
  }

  const proofs = (await loadJobProofRecords(adminClient, jobId)) as ProofRecordForItemCoverage[];
  const proofIds = proofs.map((proof) => proof.id);
  const links = await loadAllProofManifestLinks(adminClient, proofIds);
  const hasItemLevelData = manifestItems.some((item) => item.proof_requirement != null);

  const summary = deriveJobProofSummary({
    manifestItems,
    proofs,
    links,
    jobId,
    jobReference: (job.job_reference as string) ?? jobMeta?.job_reference ?? "",
    projectName: (job.project_name as string) ?? jobMeta?.project_name ?? "",
    proofRequirementsConfirmedAt: (job.proof_requirements_confirmed_at as string | null) ?? null,
    legacyProofRequired: job.proof_required as boolean | null,
  });

  const proofRequired = hasItemLevelData
    ? summary.proofRequired
    : legacyProofRequired;

  const proofState = deriveCustomerProofState({
    proofRequired,
    proofs: proofs as CustomerProofSummary[],
    jobId,
    jobReference: (job.job_reference as string) ?? jobMeta?.job_reference ?? "",
    projectName: (job.project_name as string) ?? jobMeta?.project_name ?? "",
  });

  if (hasItemLevelData && summary.hasPendingDecisions) {
    return {
      schemaAvailable: true,
      proofRequired,
      workflowStatus: (job.proof_workflow_status ?? "draft") as ProofWorkflowStatus,
      proofApproved: false,
      proofBlocked: true,
      proofStatusLabel: summary.label,
      uncoveredItemReferences: findPendingProofRequirementReferences(manifestItems),
    };
  }

  if (!proofRequired || (!hasItemLevelData && job.proof_workflow_status === "not_required")) {
    return {
      schemaAvailable: true,
      proofRequired: false,
      workflowStatus: "not_required",
      proofApproved: true,
      proofBlocked: false,
      proofStatusLabel: summary.boardLabel,
      uncoveredItemReferences: [],
    };
  }

  const workflowStatus = (job.proof_workflow_status ??
    (proofRequired ? "no_proof" : "not_required")) as ProofWorkflowStatus;

  const approvedProofIds = proofs
    .filter((proof) => proof.status === "approved")
    .map((proof) => proof.id);
  const coverage = buildProofCoverageContext(proofRequired, approvedProofIds, links, {
    manifestItems,
    proofs,
  });

  const uncovered = hasItemLevelData
    ? findUncoveredProofRequiredItemReferences(manifestItems, coverage)
    : findUncoveredRequiredItemReferences(manifestItems, coverage);

  if (
    hasItemLevelData &&
    coverage.requiredCount > 0 &&
    coverage.satisfiedCount === coverage.requiredCount
  ) {
    return {
      schemaAvailable: true,
      proofRequired: true,
      workflowStatus: "approved",
      proofApproved: true,
      proofBlocked: false,
      proofStatusLabel: summary.boardLabel,
      uncoveredItemReferences: [],
    };
  }

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
  const { data: proofs, error } = await adminClient
    .from("job_proofs")
    .select(PROOF_SELECT)
    .eq("job_id", jobId)
    .not("status", "eq", "cancelled")
    .not("status", "eq", "superseded");

  if (error) {
    return;
  }

  const activeProofs = (proofs ?? []) as JobProofRecord[];
  const aggregate = deriveAggregateJobProofWorkflow(activeProofs);
  const primaryProof = aggregate.primaryProof;
  const workflowStatus: ProofWorkflowStatus = aggregate.status;

  const updates: Record<string, unknown> = {
    proof_workflow_status: workflowStatus,
    current_proof_id: primaryProof?.id ?? null,
    updated_at: new Date().toISOString(),
  };

  if (primaryProof?.status === "approved") {
    updates.proof_approved_at = primaryProof.approved_at;
    updates.proof_approved_by_profile_id = primaryProof.approved_by_profile_id;
  } else if (workflowStatus !== "approved") {
    updates.proof_approved_at = null;
    updates.proof_approved_by_profile_id = null;
  }

  await adminClient.from("jobs").update(updates).eq("id", jobId);
}

function pickPrimaryWorkflowProof(proofs: JobProofRecord[]) {
  return deriveAggregateJobProofWorkflow(proofs).primaryProof;
}

export function deriveAggregateJobProofWorkflow(proofs: JobProofRecord[]) {
  const activeProofs = proofs.filter(
    (proof) => !["cancelled", "superseded"].includes(proof.status)
  );
  const lineageGroups = groupProofsByLineage(activeProofs);

  if (!lineageGroups.length) {
    return {
      status: "no_proof" as ProofWorkflowStatus,
      label: PROOF_WORKFLOW_STATUS_LABELS.no_proof,
      primaryProof: null as JobProofRecord | null,
      lineageStatuses: [] as ProofWorkflowStatus[],
    };
  }

  const lineageStates = lineageGroups.map((lineageProofs) => {
    const current = getCurrentProofInLineage(lineageProofs);
    return {
      current,
      status: current ? mapProofStatusToWorkflow(current) : ("no_proof" as ProofWorkflowStatus),
    };
  });

  const lineageStatuses = lineageStates.map((entry) => entry.status);
  const priority: ProofWorkflowStatus[] = [
    "changes_requested",
    "awaiting_customer",
    "ready_to_send",
    "internal_review",
    "draft",
    "no_proof",
    "approved",
  ];

  let status: ProofWorkflowStatus = "no_proof";
  for (const candidate of priority) {
    if (lineageStatuses.includes(candidate)) {
      status = candidate;
      break;
    }
  }

  const matchingCount = lineageStatuses.filter((entry) => entry === status).length;
  const label =
    matchingCount === lineageStatuses.length
      ? PROOF_WORKFLOW_STATUS_LABELS[status]
      : `${matchingCount} of ${lineageStatuses.length} proof series — ${PROOF_WORKFLOW_STATUS_LABELS[status]}`;

  const primaryProof =
    lineageStates.find((entry) => entry.status === status)?.current ??
    lineageStates[0]?.current ??
    null;

  return {
    status,
    label,
    primaryProof,
    lineageStatuses,
  };
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
