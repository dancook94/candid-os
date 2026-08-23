import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getProofSelectionDisabledReason,
  partitionProofManifestItems,
  PROOF_REQUIREMENT_LABELS,
  type ProofRequirement,
} from "@/lib/manifest/proof-requirement";
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
  disabledReason?: string;
};

export function mapManifestItemToProofSelectable(
  item: ManifestItemRecord,
  options?: { disabledReason?: string }
): ProofSelectableManifestItem {
  const finishedSize =
    item.width_mm != null && item.height_mm != null
      ? `${item.width_mm} × ${item.height_mm} mm`
      : null;

  const materialParts = [item.material, item.media_profile, item.finishing_notes].filter(
    (value) => Boolean(value?.trim())
  );

  const proofRequirement = item.proof_requirement ?? null;
  const normalizedRequirement = proofRequirement as ProofRequirement | null;
  const proofRequirementLabel =
    normalizedRequirement && normalizedRequirement in PROOF_REQUIREMENT_LABELS
      ? PROOF_REQUIREMENT_LABELS[normalizedRequirement]
      : options?.disabledReason ?? "Not selectable";

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
    disabledReason: options?.disabledReason,
  };
}

/** Loads production manifest items for proof linking, reconciling from quote when empty. */
export async function loadProofSelectableManifestItems(
  adminClient: SupabaseClient,
  jobId: string
) {
  let manifestResult = await loadManifestItemsForJob(adminClient, jobId);

  if (manifestResult.schemaMissing) {
    return {
      selectableItems: [] as ProofSelectableManifestItem[],
      disabledItems: [] as ProofSelectableManifestItem[],
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

  const { selectableItems, disabledItems } = partitionProofManifestItems(manifestResult.items);

  return {
    selectableItems: selectableItems.map((item) => mapManifestItemToProofSelectable(item)),
    disabledItems: disabledItems.map((item) =>
      mapManifestItemToProofSelectable(item, {
        disabledReason: getProofSelectionDisabledReason(item),
      })
    ),
    schemaMissing: false,
    manifestReconciled,
  };
}
