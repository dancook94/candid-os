import type { SupabaseClient } from "@supabase/supabase-js";

import { calculateProductionReadiness } from "@/lib/manifest/readiness";
import { loadManifestItemsForJob } from "@/lib/manifest/service";
import { isPrintFactoryJobRipped } from "@/lib/printfactory/ripped";
import {
  PRINTFACTORY_ACTIVITY_TYPES,
  PRINTFACTORY_LINK_SELECT,
} from "@/lib/printfactory/constants";
import { logPrintfactoryActivity } from "@/lib/printfactory/activity";
import { archiveOpportunityForProduction } from "@/lib/crm/opportunity-archive";
import { ProductionError } from "@/lib/production/errors";
import {
  JOB_BOARD_ACTIVITY_TYPES,
  type JobProductionBoardStage,
} from "@/lib/production/job-board-constants";

type JobRow = {
  id: string;
  company_id: string;
  quote_id: string;
  opportunity_id: string | null;
  contact_id: string | null;
  job_reference: string;
  production_board_stage: JobProductionBoardStage;
  ready_to_print_at: string | null;
  ready_to_print_override_at: string | null;
  status: string;
};

async function loadJob(adminClient: SupabaseClient, jobId: string): Promise<JobRow> {
  const { data, error } = await adminClient
    .from("jobs")
    .select(
      "id, company_id, quote_id, opportunity_id, contact_id, job_reference, production_board_stage, ready_to_print_at, ready_to_print_override_at, status"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  if (!data) {
    throw new ProductionError("Job not found.", 404);
  }

  return data as JobRow;
}

export async function refreshManifestItemPrintfactorySatisfaction(
  adminClient: SupabaseClient,
  productionItemId: string
) {
  const { data: links, error: linksError } = await adminClient
    .from("printfactory_job_manifest_items")
    .select(`${PRINTFACTORY_LINK_SELECT}, printfactory_jobs(id, printfactory_status, progress, ignored_at, job_match_status)`)
    .eq("production_item_id", productionItemId)
    .eq("link_status", "confirmed");

  if (linksError) {
    if (linksError.code === "42P01") {
      return false;
    }

    throw new ProductionError(linksError.message, 500);
  }

  const satisfied = (links ?? []).some((link) => {
    const pfJobRaw = link.printfactory_jobs as unknown;
    const pfJob = Array.isArray(pfJobRaw) ? pfJobRaw[0] : pfJobRaw;

    if (!pfJob || typeof pfJob !== "object") {
      return false;
    }

    const typed = pfJob as {
      printfactory_status: string | null;
      progress: number | null;
      ignored_at: string | null;
      job_match_status: string | null;
    };

    return isPrintFactoryJobRipped(typed);
  });

  const updates: Record<string, unknown> = {
    printfactory_satisfied: satisfied,
  };

  if (satisfied) {
    updates.production_requirement_status = "satisfied";
  }

  const { error: updateError } = await adminClient
    .from("production_items")
    .update(updates)
    .eq("id", productionItemId);

  if (updateError) {
    throw new ProductionError(updateError.message, 500);
  }

  return satisfied;
}

export async function moveJobToReadyToPrint(
  adminClient: SupabaseClient,
  job: JobRow,
  actorProfileId: string | null,
  options: { isAutomatic?: boolean; reason?: string | null } = {}
) {
  if (job.production_board_stage === "ready_to_print" && job.ready_to_print_at) {
    return { moved: false as const };
  }

  const now = new Date().toISOString();
  const previousStage = job.production_board_stage;

  const { error: updateError } = await adminClient
    .from("jobs")
    .update({
      production_board_stage: "ready_to_print",
      ready_to_print_at: job.ready_to_print_at ?? now,
      production_board_on_hold: false,
    })
    .eq("id", job.id);

  if (updateError) {
    throw new ProductionError(updateError.message, 500);
  }

  await adminClient.from("job_production_board_stage_history").insert({
    job_id: job.id,
    previous_stage: previousStage,
    new_stage: "ready_to_print",
    changed_by_profile_id: actorProfileId,
    change_reason: options.reason ?? null,
    is_automatic: Boolean(options.isAutomatic),
  });

  await logPrintfactoryActivity(adminClient, {
    activityType: JOB_BOARD_ACTIVITY_TYPES.jobReadyToPrint,
    description: `${job.job_reference} moved to Ready to Print.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId,
    metadata: {
      automatic: Boolean(options.isAutomatic),
      reason: options.reason ?? null,
    },
  });

  const archiveResult = await archiveOpportunityForProduction(
    adminClient,
    job.opportunity_id,
    actorProfileId
  );

  return {
    moved: true as const,
    archiveWarning: archiveResult.warning,
  };
}

export async function refreshJobProductionReadiness(
  adminClient: SupabaseClient,
  jobId: string,
  actorProfileId?: string | null
) {
  const job = await loadJob(adminClient, jobId);
  const { items } = await loadManifestItemsForJob(adminClient, jobId);

  const readiness = calculateProductionReadiness(items, {
    hasOverride: Boolean(job.ready_to_print_override_at),
  });

  if (!readiness.isReady) {
    return { readiness, movedToReadyToPrint: false };
  }

  if (
    job.production_board_stage === "accepted_quotes" ||
    (!job.ready_to_print_at && job.production_board_stage !== "on_hold")
  ) {
    const result = await moveJobToReadyToPrint(adminClient, job, actorProfileId ?? null, {
      isAutomatic: !job.ready_to_print_override_at,
    });

    return {
      readiness,
      movedToReadyToPrint: result.moved,
      archiveWarning: result.archiveWarning ?? null,
    };
  }

  return { readiness, movedToReadyToPrint: false };
}

export async function confirmPrintfactoryItemLink(
  adminClient: SupabaseClient,
  printfactoryJobId: string,
  productionItemId: string,
  actorProfileId: string
) {
  const now = new Date().toISOString();

  const { data: link, error } = await adminClient
    .from("printfactory_job_manifest_items")
    .upsert(
      {
        printfactory_job_id: printfactoryJobId,
        production_item_id: productionItemId,
        link_status: "confirmed",
        match_method: "manual",
        match_confidence: 1,
        confirmed_by_profile_id: actorProfileId,
        confirmed_at: now,
      },
      { onConflict: "printfactory_job_id,production_item_id" }
    )
    .select(`${PRINTFACTORY_LINK_SELECT}, production_items!inner(job_id, company_id, quote_id, item_name)`)
    .single();

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  const productionItemRaw = link.production_items as unknown;
  const productionItemData = Array.isArray(productionItemRaw)
    ? productionItemRaw[0]
    : productionItemRaw;
  const productionItem = productionItemData as {
    job_id: string;
    company_id: string;
    quote_id: string;
    item_name: string;
  };

  await refreshManifestItemPrintfactorySatisfaction(adminClient, productionItemId);

  const { data: pfJob } = await adminClient
    .from("printfactory_jobs")
    .select("id, job_name, candid_job_id, jobs(opportunity_id, contact_id, job_reference)")
    .eq("id", printfactoryJobId)
    .maybeSingle();

  const jobMetaRaw = pfJob?.jobs as unknown;
  const jobMetaData = Array.isArray(jobMetaRaw) ? jobMetaRaw[0] : jobMetaRaw;
  const jobMeta = jobMetaData as {
    opportunity_id: string | null;
    contact_id: string | null;
    job_reference: string;
  } | null;

  await logPrintfactoryActivity(adminClient, {
    activityType: PRINTFACTORY_ACTIVITY_TYPES.itemLinkConfirmed,
    description: `PrintFactory job linked to manifest item "${productionItem.item_name}" on ${jobMeta?.job_reference ?? "job"}.`,
    companyId: productionItem.company_id,
    quoteId: productionItem.quote_id,
    jobId: productionItem.job_id,
    opportunityId: jobMeta?.opportunity_id ?? null,
    contactId: jobMeta?.contact_id ?? null,
    actorProfileId,
    metadata: {
      printfactory_job_id: printfactoryJobId,
      production_item_id: productionItemId,
    },
  });

  await refreshJobProductionReadiness(
    adminClient,
    productionItem.job_id,
    actorProfileId
  );

  return link;
}
