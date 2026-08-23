import type { SupabaseClient } from "@supabase/supabase-js";

import type { ManifestItemRecord } from "@/lib/manifest/types";
import {
  loadManifestItemsForJob,
  reconcileProductionManifestForJob,
} from "@/lib/manifest/service";

export type ProofSelectableManifestItem = {
  id: string;
  itemReference: string | null;
  itemName: string;
  description: string | null;
  quantity: number | null;
  finishedSize: string | null;
  materialSpec: string | null;
  proofRequirement: string | null;
  proofRequirementLabel: string;
  isProofRequired: boolean;
};

export function mapManifestItemToProofSelectable(
  item: ManifestItemRecord
): ProofSelectableManifestItem {
  const finishedSize =
    item.width_mm != null && item.height_mm != null
      ? `${item.width_mm} × ${item.height_mm} mm`
      : null;

  const materialParts = [item.material, item.media_profile, item.finishing_notes].filter(
    (value) => Boolean(value?.trim())
  );

  const proofRequirement = item.proof_requirement ?? null;
  const proofRequirementLabel =
    proofRequirement === "required"
      ? "Required proof"
      : proofRequirement === "not_required"
        ? "No proof required"
        : proofRequirement === "not_applicable"
          ? "Not applicable"
          : proofRequirement === "pending"
            ? "Awaiting decision"
            : "Proof optional";

  return {
    id: item.id,
    itemReference: item.item_reference,
    itemName: item.item_name,
    description: item.description?.trim() || null,
    quantity: item.quantity,
    finishedSize,
    materialSpec: materialParts.length ? materialParts.join(" · ") : null,
    proofRequirement,
    proofRequirementLabel,
    isProofRequired: proofRequirement === "required",
  };
}

function filterSelectableManifestItems(items: ManifestItemRecord[]) {
  return items
    .filter((item) => !item.deleted_at && !item.combined_into_item_id)
    .filter((item) => item.production_requirement_status === "required")
    .filter((item) => item.proof_requirement !== "not_applicable");
}

/** Loads production manifest items for proof linking, reconciling from quote when empty. */
export async function loadProofSelectableManifestItems(
  adminClient: SupabaseClient,
  jobId: string
) {
  let manifestResult = await loadManifestItemsForJob(adminClient, jobId);

  if (manifestResult.schemaMissing) {
    return {
      items: [] as ProofSelectableManifestItem[],
      schemaMissing: true,
      manifestReconciled: false,
    };
  }

  let manifestReconciled = false;

  if (manifestResult.items.length === 0) {
    await reconcileProductionManifestForJob(adminClient, jobId);
    manifestResult = await loadManifestItemsForJob(adminClient, jobId);
    manifestReconciled = true;
  }

  return {
    items: filterSelectableManifestItems(manifestResult.items).map(
      mapManifestItemToProofSelectable
    ),
    schemaMissing: false,
    manifestReconciled,
  };
}
