import type { SupabaseClient } from "@supabase/supabase-js";

import type { ManifestSourceType } from "@/lib/manifest/constants";
import { ProductionError } from "@/lib/production/errors";

export async function generateQuotedItemReference(
  adminClient: SupabaseClient,
  jobId: string,
  jobReference: string
) {
  const { data, error } = await adminClient
    .from("production_items")
    .select("item_reference")
    .eq("job_id", jobId);

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  const quotedPattern = new RegExp(
    `^${escapeRegex(jobReference)}-(\\d{2})$`,
    "i"
  );

  let maxSequence = 0;

  for (const row of data ?? []) {
    const reference = row.item_reference as string | null;

    if (!reference) {
      continue;
    }

    const match = quotedPattern.exec(reference);

    if (match) {
      maxSequence = Math.max(maxSequence, Number.parseInt(match[1], 10));
    }
  }

  return `${jobReference}-${String(maxSequence + 1).padStart(2, "0")}`;
}

export async function generateAdditionalItemReference(
  adminClient: SupabaseClient,
  jobId: string,
  jobReference: string
) {
  const { data, error } = await adminClient
    .from("production_items")
    .select("item_reference")
    .eq("job_id", jobId);

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  const additionalPattern = new RegExp(
    `^${escapeRegex(jobReference)}-A(\\d{2})$`,
    "i"
  );

  let maxSequence = 0;

  for (const row of data ?? []) {
    const reference = row.item_reference as string | null;

    if (!reference) {
      continue;
    }

    const match = additionalPattern.exec(reference);

    if (match) {
      maxSequence = Math.max(maxSequence, Number.parseInt(match[1], 10));
    }
  }

  return `${jobReference}-A${String(maxSequence + 1).padStart(2, "0")}`;
}

export async function generateItemReferenceForSourceType(
  adminClient: SupabaseClient,
  jobId: string,
  jobReference: string,
  sourceType: ManifestSourceType
) {
  if (sourceType === "additional" || sourceType === "replacement") {
    return generateAdditionalItemReference(adminClient, jobId, jobReference);
  }

  return generateQuotedItemReference(adminClient, jobId, jobReference);
}

export async function reconcileMissingItemReferences(
  adminClient: SupabaseClient,
  jobId: string,
  jobReference: string
) {
  const { data: items, error } = await adminClient
    .from("production_items")
    .select("id, item_reference, source_type, created_at")
    .eq("job_id", jobId)
    .is("item_reference", null)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  let assigned = 0;

  for (const item of items ?? []) {
    const sourceType = (item.source_type as ManifestSourceType | null) ?? "quoted";
    const reference = await generateItemReferenceForSourceType(
      adminClient,
      jobId,
      jobReference,
      sourceType
    );

    const { error: updateError } = await adminClient
      .from("production_items")
      .update({ item_reference: reference })
      .eq("id", item.id);

    if (updateError) {
      throw new ProductionError(updateError.message, 500);
    }

    assigned += 1;
  }

  return { assigned };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
