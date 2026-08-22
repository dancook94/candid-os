import type { SupabaseClient } from "@supabase/supabase-js";

import { loadManifestItemsForJob } from "@/lib/manifest/service";
import { evaluateJobProofGate } from "@/lib/proofs/gates";

export type ProductionProofGate = {
  proofRequired: boolean;
  proofApproved: boolean;
  proofBlocked: boolean;
  proofStatusLabel: string;
};

export async function loadProductionProofGate(
  adminClient: SupabaseClient,
  jobId: string
): Promise<ProductionProofGate> {
  let manifestItems: Awaited<ReturnType<typeof loadManifestItemsForJob>>["items"] = [];

  try {
    const manifestResult = await loadManifestItemsForJob(adminClient, jobId);
    manifestItems = manifestResult.items;
  } catch {
    manifestItems = [];
  }

  const evaluation = await evaluateJobProofGate(adminClient, jobId, manifestItems);

  if (!evaluation.schemaAvailable) {
    return {
      proofRequired: evaluation.proofRequired,
      proofApproved: !evaluation.proofRequired,
      proofBlocked: false,
      proofStatusLabel: evaluation.proofStatusLabel,
    };
  }

  return {
    proofRequired: evaluation.proofRequired,
    proofApproved: evaluation.proofApproved,
    proofBlocked: evaluation.proofBlocked,
    proofStatusLabel: evaluation.proofStatusLabel,
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
