import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MANIFEST_ACTIVITY_TYPES,
  type ManifestBillingStatus,
  type ProductionRequirementStatus,
} from "@/lib/manifest/constants";
import {
  defaultProofRequirementForItemName,
  normalizeProofRequirement,
  type ProofRequirement,
} from "@/lib/manifest/proof-requirement";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import type { ProductionStatus } from "@/lib/production/constants";

export type ManifestItemPreCancellationState = {
  production_requirement_status: ProductionRequirementStatus;
  billing_status: ManifestBillingStatus;
  production_status: ProductionStatus;
  proof_requirement: ProofRequirement | null;
};

export function buildManifestItemPreCancellationState(
  item: Pick<
    ManifestItemRecord,
    | "production_requirement_status"
    | "billing_status"
    | "production_status"
    | "proof_requirement"
  >
): ManifestItemPreCancellationState {
  return {
    production_requirement_status:
      item.production_requirement_status as ProductionRequirementStatus,
    billing_status: item.billing_status as ManifestBillingStatus,
    production_status: item.production_status,
    proof_requirement: normalizeProofRequirement(item.proof_requirement ?? null),
  };
}

export function defaultReinstateStateForItem(
  item: Pick<ManifestItemRecord, "item_name" | "production_status">
): ManifestItemPreCancellationState {
  return {
    production_requirement_status: "required",
    billing_status: "billable",
    production_status: item.production_status,
    proof_requirement: defaultProofRequirementForItemName(item.item_name),
  };
}

export async function loadManifestItemCancellationSnapshot(
  adminClient: SupabaseClient,
  productionItemId: string
): Promise<ManifestItemPreCancellationState | null> {
  const { data, error } = await adminClient
    .from("crm_activity")
    .select("metadata")
    .eq("activity_type", MANIFEST_ACTIVITY_TYPES.productionItemCancelled)
    .eq("metadata->>production_item_id", productionItemId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.metadata) {
    return null;
  }

  const metadata = data.metadata as Record<string, unknown>;
  const snapshot = metadata.pre_cancellation_state as
    | ManifestItemPreCancellationState
    | undefined;

  if (!snapshot) {
    return null;
  }

  return {
    production_requirement_status: snapshot.production_requirement_status,
    billing_status: snapshot.billing_status,
    production_status: snapshot.production_status,
    proof_requirement: normalizeProofRequirement(snapshot.proof_requirement ?? null),
  };
}
