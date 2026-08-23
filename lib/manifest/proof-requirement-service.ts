import type { SupabaseClient } from "@supabase/supabase-js";

import { MANIFEST_ITEM_SELECT } from "@/lib/manifest/constants";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import {
  deriveJobProofRequiredFromManifest,
  hasUnresolvedProofRequirementDecisions,
} from "@/lib/manifest/proof-requirement";
import { ProofError } from "@/lib/proofs/errors";

export async function loadManifestItemsForProofContext(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data, error } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("job_id", jobId)
    .is("deleted_at", null);

  if (error) {
    if (error.code === "42703") {
      return { items: [] as ManifestItemRecord[], schemaMissing: true as const };
    }

    throw new ProofError(error.message, 500);
  }

  return {
    items: (data ?? []) as ManifestItemRecord[],
    schemaMissing: false as const,
  };
}

export async function syncJobProofRequiredFromManifest(
  adminClient: SupabaseClient,
  jobId: string,
  manifestItems?: ManifestItemRecord[]
) {
  const items =
    manifestItems ??
    (await loadManifestItemsForProofContext(adminClient, jobId)).items;

  const hasItemLevelData = items.some((item) => item.proof_requirement != null);
  if (!hasItemLevelData) {
    return { updated: false, proofRequired: null as boolean | null };
  }

  const proofRequired = deriveJobProofRequiredFromManifest(items);

  const { error } = await adminClient
    .from("jobs")
    .update({
      proof_required: proofRequired,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    if (error.code === "42703") {
      return { updated: false, proofRequired: null };
    }

    throw new ProofError(error.message, 500);
  }

  return { updated: true, proofRequired };
}

export async function updateManifestItemProofRequirement(
  adminClient: SupabaseClient,
  {
    itemId,
    proofRequirement,
    actorProfileId,
  }: {
    itemId: string;
    proofRequirement: string;
    actorProfileId: string;
  }
) {
  const { data: existing, error: loadError } = await adminClient
    .from("production_items")
    .select(`${MANIFEST_ITEM_SELECT}, jobs(id, job_reference, proof_requirements_confirmed_at)`)
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadError) {
    if (loadError.code === "42703") {
      throw new ProofError(
        "Item-level proof requirement migration is not applied. Apply 20260823160000_production_items_proof_requirement.sql in Supabase.",
        503
      );
    }

    throw new ProofError(loadError.message, 500);
  }

  if (!existing) {
    throw new ProofError("Manifest item not found.", 404);
  }

  const { data: item, error } = await adminClient
    .from("production_items")
    .update({
      proof_requirement: proofRequirement,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .select(MANIFEST_ITEM_SELECT)
    .single();

  if (error || !item) {
    throw new ProofError(error?.message ?? "Unable to update proof requirement.", 500);
  }

  const jobId = item.job_id as string;
  const { items } = await loadManifestItemsForProofContext(adminClient, jobId);
  await syncJobProofRequiredFromManifest(adminClient, jobId, items);

  if (hasUnresolvedProofRequirementDecisions(items)) {
    await adminClient
      .from("jobs")
      .update({
        proof_requirements_confirmed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }

  return item as ManifestItemRecord;
}

export async function confirmManifestProofRequirements(
  adminClient: SupabaseClient,
  jobId: string,
  actorProfileId: string
) {
  const { items, schemaMissing } = await loadManifestItemsForProofContext(
    adminClient,
    jobId
  );

  if (schemaMissing) {
    throw new ProofError(
      "Item-level proof requirement migration is not applied. Apply 20260823160000_production_items_proof_requirement.sql in Supabase.",
      503
    );
  }

  if (hasUnresolvedProofRequirementDecisions(items)) {
    throw new ProofError(
      "Set a proof requirement for every proofable manifest item before confirming.",
      409
    );
  }

  const proofRequired = deriveJobProofRequiredFromManifest(items);

  const { error } = await adminClient
    .from("jobs")
    .update({
      proof_required: proofRequired,
      proof_requirements_confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new ProofError(error.message, 500);
  }

  return {
    proofRequired,
    confirmedAt: new Date().toISOString(),
    requiredItemCount: items.filter((item) => item.proof_requirement === "required").length,
  };
}
