import type { SupabaseClient } from "@supabase/supabase-js";

import { ProductionError } from "@/lib/production/errors";

export type ReprintClassification =
  | "production_retry_no_charge"
  | "customer_reprint_billable"
  | "replacement"
  | "additional_quantity"
  | "ignored";

export async function detectPossibleReprintsForManifestItem(
  adminClient: SupabaseClient,
  productionItemId: string,
  excludePrintfactoryJobId?: string
) {
  const { data: existingLinks, error: linksError } = await adminClient
    .from("printfactory_job_manifest_items")
    .select("id, printfactory_job_id, link_status, reprint_classification")
    .eq("production_item_id", productionItemId)
    .in("link_status", ["confirmed", "suggested"]);

  if (linksError) {
    if (linksError.code === "42P01") {
      return [];
    }

    throw new ProductionError(linksError.message, 500);
  }

  const confirmed = (existingLinks ?? []).filter((link) => link.link_status === "confirmed");

  if (confirmed.length === 0 || !excludePrintfactoryJobId) {
    return [];
  }

  const alreadyLinked = confirmed.some(
    (link) => link.printfactory_job_id === excludePrintfactoryJobId
  );

  if (alreadyLinked) {
    return [];
  }

  return [
    {
      productionItemId,
      existingConfirmedCount: confirmed.length,
      message: "Possible reprint — another PrintFactory file is linked to this manifest item.",
    },
  ];
}

export async function markPossibleReprintLink(
  adminClient: SupabaseClient,
  linkId: string,
  isPossibleReprint: boolean
) {
  const { error } = await adminClient
    .from("printfactory_job_manifest_items")
    .update({ is_possible_reprint: isPossibleReprint })
    .eq("id", linkId);

  if (error) {
    if (error.code === "42703" || error.code === "42P01") {
      return false;
    }

    throw new ProductionError(error.message, 500);
  }

  return true;
}

export async function classifyReprintLink(
  adminClient: SupabaseClient,
  input: {
    linkId: string;
    classification: ReprintClassification;
    reason: string;
    actorProfileId: string;
  }
) {
  const now = new Date().toISOString();

  const { data, error } = await adminClient
    .from("printfactory_job_manifest_items")
    .update({
      reprint_classification: input.classification,
      reprint_reason: input.reason.trim(),
      classified_by_profile_id: input.actorProfileId,
      classified_at: now,
      is_possible_reprint: false,
    })
    .eq("id", input.linkId)
    .select("id, production_item_id")
    .maybeSingle();

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  return data;
}

export async function flagUnclassifiedReprintsForJob(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data: items, error: itemsError } = await adminClient
    .from("production_items")
    .select("id")
    .eq("job_id", jobId)
    .is("deleted_at", null);

  if (itemsError) {
    return [];
  }

  const warnings: string[] = [];

  for (const item of items ?? []) {
    const { data: links } = await adminClient
      .from("printfactory_job_manifest_items")
      .select("id, is_possible_reprint, reprint_classification, link_status")
      .eq("production_item_id", item.id)
      .eq("link_status", "confirmed");

    const confirmedLinks = links ?? [];

    if (confirmedLinks.length > 1) {
      const unclassified = confirmedLinks.filter(
        (link) => link.is_possible_reprint && !link.reprint_classification
      );

      if (unclassified.length > 0) {
        warnings.push(
          `Manifest item has ${unclassified.length} unclassified possible reprint(s).`
        );
      }
    }
  }

  return warnings;
}
