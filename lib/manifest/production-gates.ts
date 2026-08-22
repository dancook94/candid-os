import type { SupabaseClient } from "@supabase/supabase-js";

import { loadJobProofRequired } from "@/lib/jobs/proof-required";

export type ProductionProofGate = {
  proofRequired: boolean;
  proofApproved: boolean;
  proofBlocked: boolean;
  proofStatusLabel: string;
};

/**
 * Proof gate for Ready to Print. When proofing tables are not yet deployed,
 * jobs are not blocked — only structure is in place for the next phase.
 */
export async function loadProductionProofGate(
  adminClient: SupabaseClient,
  jobId: string
): Promise<ProductionProofGate> {
  const proofRequired = await loadJobProofRequired(adminClient, jobId);

  if (!proofRequired) {
    return {
      proofRequired: false,
      proofApproved: true,
      proofBlocked: false,
      proofStatusLabel: "Proof not required",
    };
  }

  const proofState = await loadJobProofApprovalState(adminClient, jobId);

  if (!proofState.available) {
    return {
      proofRequired: true,
      proofApproved: true,
      proofBlocked: false,
      proofStatusLabel: "Awaiting proof workflow",
    };
  }

  return {
    proofRequired: true,
    proofApproved: proofState.approved,
    proofBlocked: !proofState.approved,
    proofStatusLabel: proofState.approved ? "Proof approved" : proofState.label,
  };
}

async function loadJobProofApprovalState(
  adminClient: SupabaseClient,
  jobId: string
): Promise<
  | { available: false }
  | { available: true; approved: boolean; label: string }
> {
  const { data, error } = await adminClient
    .from("jobs")
    .select("proof_approved_at, proof_status")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    return { available: false };
  }

  if (!data || (data.proof_approved_at === undefined && data.proof_status === undefined)) {
    return { available: false };
  }

  const approved = Boolean(data.proof_approved_at) || data.proof_status === "approved";

  return {
    available: true,
    approved,
    label: approved ? "Proof approved" : "Proof approval required",
  };
}

export function applyProofGateToReadiness(
  productionReady: boolean,
  proofGate: ProductionProofGate,
  hasOverride: boolean
) {
  if (hasOverride) {
    return true;
  }

  if (!productionReady) {
    return false;
  }

  if (proofGate.proofRequired && proofGate.proofBlocked) {
    return false;
  }

  return true;
}
