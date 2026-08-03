import type { SupabaseClient } from "@supabase/supabase-js";

import type { ManifestSourceType } from "@/lib/manifest/constants";
import { MANIFEST_ITEM_SELECT } from "@/lib/manifest/constants";
import { generateAdditionalItemReference, reconcileMissingItemReferences } from "@/lib/manifest/item-reference";
import { logManifestActivity, MANIFEST_ACTIVITY_TYPES } from "@/lib/manifest/activity";
import { PRINTFACTORY_ACTIVITY_TYPES } from "@/lib/printfactory/constants";
import { logPrintfactoryActivity } from "@/lib/printfactory/activity";
import { confirmPrintfactoryItemLink } from "@/lib/printfactory/readiness-service";
import { ProductionError } from "@/lib/production/errors";
import { deriveCustomerSafeStatus } from "@/lib/production/status-sync";

export type CreateItemFromPrintfactoryInput = {
  classification:
    | "additional_billable"
    | "replacement"
    | "no_charge_reprint"
    | "internal_test"
    | "ignore";
  title?: string;
  material?: string | null;
  machine?: string | null;
  widthMm?: number | null;
  heightMm?: number | null;
};

function mapClassificationToSourceType(
  classification: CreateItemFromPrintfactoryInput["classification"]
): ManifestSourceType | null {
  switch (classification) {
    case "additional_billable":
      return "additional";
    case "replacement":
      return "replacement";
    case "no_charge_reprint":
      return "reprint";
    case "internal_test":
      return "test";
    case "ignore":
      return null;
  }
}

export async function createProductionItemFromPrintfactoryJob(
  adminClient: SupabaseClient,
  printfactoryJobId: string,
  input: CreateItemFromPrintfactoryInput,
  actorProfileId: string
) {
  const { data: pfJob, error: pfError } = await adminClient
    .from("printfactory_jobs")
    .select("*")
    .eq("id", printfactoryJobId)
    .maybeSingle();

  if (pfError) {
    throw new ProductionError(pfError.message, 500);
  }

  if (!pfJob) {
    throw new ProductionError("PrintFactory job not found.", 404);
  }

  if (!pfJob.candid_job_id) {
    throw new ProductionError("PrintFactory job is not matched to a Candid job.", 400);
  }

  if (input.classification === "ignore") {
    const now = new Date().toISOString();

    await adminClient
      .from("printfactory_jobs")
      .update({
        job_match_status: "ignored",
        ignored_at: now,
        ignored_by_profile_id: actorProfileId,
        ignore_reason: "Marked as ignore from additional item flow.",
      })
      .eq("id", printfactoryJobId);

    return { ignored: true as const };
  }

  const sourceType = mapClassificationToSourceType(input.classification);

  if (!sourceType) {
    throw new ProductionError("Invalid classification.", 400);
  }

  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select(
      "id, company_id, quote_id, quote_version_id, opportunity_id, contact_id, job_reference"
    )
    .eq("id", pfJob.candid_job_id)
    .maybeSingle();

  if (jobError || !job) {
    throw new ProductionError(jobError?.message ?? "Candid job not found.", 404);
  }

  const itemReference = await generateAdditionalItemReference(
    adminClient,
    job.id,
    job.job_reference
  );

  const billingStatus =
    input.classification === "additional_billable"
      ? "price_required"
      : input.classification === "no_charge_reprint"
        ? "reprint_no_charge"
        : "billable";

  const title =
    input.title?.trim() ||
    pfJob.job_name?.trim() ||
    pfJob.source_file_name?.trim() ||
    "Additional production item";

  const { data: item, error: insertError } = await adminClient
    .from("production_items")
    .insert({
      job_id: job.id,
      company_id: job.company_id,
      quote_id: job.quote_id,
      quote_version_id: job.quote_version_id,
      item_reference: itemReference,
      item_name: title,
      description: pfJob.source_file_name,
      source_type: sourceType,
      billing_status: billingStatus,
      production_requirement_status: "required",
      requires_printfactory: true,
      machine: input.machine ?? pfJob.device,
      material: input.material ?? pfJob.media_type,
      synology_source_path: pfJob.source_file_path,
      printfactory_job_guid: pfJob.printfactory_job_guid,
      production_status: "artwork",
      customer_safe_status: deriveCustomerSafeStatus("artwork"),
    })
    .select(MANIFEST_ITEM_SELECT)
    .single();

  if (insertError || !item) {
    throw new ProductionError(insertError?.message ?? "Unable to create item.", 500);
  }

  await confirmPrintfactoryItemLink(
    adminClient,
    printfactoryJobId,
    item.id,
    actorProfileId
  );

  await logManifestActivity(adminClient, {
    activityType: MANIFEST_ACTIVITY_TYPES.productionItemAdded,
    description: `Additional production item "${title}" created from PrintFactory on ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    productionItemId: item.id,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
    metadata: { source_type: sourceType, billing_status: billingStatus },
  });

  await logPrintfactoryActivity(adminClient, {
    activityType: PRINTFACTORY_ACTIVITY_TYPES.additionalItemCreated,
    description: `PrintFactory file created manifest item ${itemReference} on ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
    metadata: {
      printfactory_job_id: printfactoryJobId,
      production_item_id: item.id,
      classification: input.classification,
    },
  });

  return { item, ignored: false as const };
}

export async function reconcileAllMissingItemReferences(
  adminClient: SupabaseClient,
  jobId?: string
) {
  let query = adminClient.from("jobs").select("id, job_reference");

  if (jobId) {
    query = query.eq("id", jobId);
  }

  const { data: jobs, error } = await query;

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  let totalAssigned = 0;

  for (const job of jobs ?? []) {
    const result = await reconcileMissingItemReferences(
      adminClient,
      job.id as string,
      job.job_reference as string
    );
    totalAssigned += result.assigned;
  }

  return { assigned: totalAssigned };
}
