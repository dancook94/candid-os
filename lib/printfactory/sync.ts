import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchPrintfactoryJobsFromApi,
  getPrintfactoryConnectionStatus,
  type PrintfactoryApiJob,
} from "@/lib/printfactory/client";
import {
  PRINTFACTORY_ACTIVITY_TYPES,
  PRINTFACTORY_JOB_SELECT,
} from "@/lib/printfactory/constants";
import { PrintfactoryError, isMissingPrintfactorySchemaError } from "@/lib/printfactory/errors";
import { logPrintfactoryActivity } from "@/lib/printfactory/activity";
import {
  matchPrintfactoryJobToCandidJob,
  shouldPreserveExistingJobMatch,
} from "@/lib/printfactory/job-matching";
import {
  countPrintfactoryRecordsByTab,
  filterPrintfactoryRecordsByTab,
  type ExceptionQueueTab,
} from "@/lib/printfactory/matching-queue";
import { createItemSuggestionsForJob } from "@/lib/printfactory/matching-service";
import { refreshJobProductionReadiness } from "@/lib/printfactory/readiness-service";

export type PrintfactorySyncResult = {
  ok: boolean;
  imported: number;
  updated: number;
  parentJobsAutoMatched: number;
  parentJobSuggestions: number;
  itemSuggestions: number;
  confirmedLinks: number;
  needsAttention: number;
  ignored: number;
  errors: number;
  /** @deprecated use parentJobsAutoMatched */
  matched: number;
  /** @deprecated use needsAttention */
  unmatched: number;
  /** @deprecated use parentJobSuggestions */
  suggested: number;
  /** @deprecated use errors */
  failed: number;
  /** @deprecated use itemSuggestions */
  itemSuggestionsCreated: number;
  error: string | null;
  errorCode: string | null;
  connectionStatus: ReturnType<typeof getPrintfactoryConnectionStatus>;
  summaryMessage: string | null;
};

type ExistingPrintfactoryRow = {
  id: string;
  printfactory_job_guid: string;
  candid_job_id: string | null;
  job_match_status: string;
};

async function loadExistingByGuid(
  adminClient: SupabaseClient,
  guids: string[]
) {
  if (guids.length === 0) {
    return new Map<string, ExistingPrintfactoryRow>();
  }

  const { data, error } = await adminClient
    .from("printfactory_jobs")
    .select("id, printfactory_job_guid, candid_job_id, job_match_status")
    .in("printfactory_job_guid", guids);

  if (error) {
    throw error;
  }

  return new Map(
    (data ?? []).map((row) => [
      row.printfactory_job_guid as string,
      row as ExistingPrintfactoryRow,
    ])
  );
}

async function upsertPrintfactoryJob(
  adminClient: SupabaseClient,
  apiJob: PrintfactoryApiJob,
  existing: ExistingPrintfactoryRow | undefined,
  now: string
) {
  const baseRow = {
    printfactory_job_guid: apiJob.guid,
    job_name: apiJob.name,
    source_file_path: apiJob.sourceFilePath,
    source_file_name: apiJob.sourceFileName,
    document_name: apiJob.documentName,
    device: apiJob.device,
    media_type: apiJob.mediaType,
    producer: apiJob.producer,
    printfactory_status: apiJob.status,
    progress: apiJob.progress,
    created_at_printfactory: apiJob.createdAt,
    updated_at_printfactory: apiJob.updatedAt,
    raw_metadata: apiJob.rawMetadata ?? null,
    last_seen_at: now,
  };

  if (existing) {
    const { data, error } = await adminClient
      .from("printfactory_jobs")
      .update(baseRow)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return { row: data, created: false };
  }

  const { data, error } = await adminClient
    .from("printfactory_jobs")
    .insert({
      ...baseRow,
      first_seen_at: now,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return { row: data, created: true };
}

async function applyJobMatchingIfNeeded(
  adminClient: SupabaseClient,
  row: Record<string, unknown>
) {
  const jobMatchStatus = row.job_match_status as string;

  if (shouldPreserveExistingJobMatch(jobMatchStatus)) {
    return row;
  }

  const match = await matchPrintfactoryJobToCandidJob(adminClient, {
    sourceFilePath: row.source_file_path as string | null,
    sourceFileName: row.source_file_name as string | null,
    jobName: row.job_name as string | null,
    documentName: row.document_name as string | null,
  });

  const { data, error } = await adminClient
    .from("printfactory_jobs")
    .update({
      candid_job_id: match.candidJobId,
      suggested_candid_job_id: match.suggestedCandidJobId,
      job_match_status: match.jobMatchStatus,
      job_match_method: match.jobMatchMethod,
      job_match_confidence: match.jobMatchConfidence,
      extracted_job_reference: match.extractedJobReference,
      match_suggestion_reason: match.matchSuggestionReason,
      match_suggestion_details: match.matchSuggestionDetails,
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

function buildSyncSummaryMessage(stats: {
  imported: number;
  updated: number;
  parentJobsAutoMatched: number;
  parentJobSuggestions: number;
  needsAttention: number;
}) {
  const total = stats.imported + stats.updated;

  if (total === 0) {
    return "No PrintFactory jobs returned from sync.";
  }

  const parts = [
    `Synced ${total} job${total === 1 ? "" : "s"}`,
    `${stats.parentJobsAutoMatched} parent job${stats.parentJobsAutoMatched === 1 ? "" : "s"} matched automatically`,
  ];

  if (stats.parentJobSuggestions > 0) {
    parts.push(
      `${stats.parentJobSuggestions} suggested match${stats.parentJobSuggestions === 1 ? "" : "es"}`
    );
  }

  if (stats.needsAttention > 0) {
    parts.push(
      `${stats.needsAttention} need${stats.needsAttention === 1 ? "s" : ""} attention`
    );
  }

  return `${parts[0]}: ${parts.slice(1).join(", ")}.`;
}

export async function syncPrintfactoryJobs(
  adminClient: SupabaseClient,
  actorProfileId?: string | null
): Promise<PrintfactorySyncResult> {
  const connectionStatus = getPrintfactoryConnectionStatus();

  const emptyResult = (
    partial: Partial<PrintfactorySyncResult> = {}
  ): PrintfactorySyncResult => ({
    ok: false,
    imported: 0,
    updated: 0,
    parentJobsAutoMatched: 0,
    parentJobSuggestions: 0,
    itemSuggestions: 0,
    confirmedLinks: 0,
    needsAttention: 0,
    ignored: 0,
    errors: 0,
    matched: 0,
    unmatched: 0,
    suggested: 0,
    failed: 0,
    itemSuggestionsCreated: 0,
    error: null,
    errorCode: null,
    connectionStatus,
    summaryMessage: null,
    ...partial,
  });

  if (!connectionStatus.configured) {
    return emptyResult({
      error: `PrintFactory is not configured. Missing: ${connectionStatus.missing.join(", ")}`,
      errorCode: "not_configured",
    });
  }

  let apiJobs: PrintfactoryApiJob[];

  try {
    apiJobs = await fetchPrintfactoryJobsFromApi();
  } catch (error) {
    if (error instanceof PrintfactoryError) {
      return emptyResult({
        error: error.message,
        errorCode: error.code,
      });
    }

    return emptyResult({
      error: error instanceof Error ? error.message : "PrintFactory sync failed.",
      errorCode: "sync_failed",
    });
  }

  if (apiJobs.length === 0) {
    return emptyResult({
      ok: true,
      error: "PrintFactory API returned no jobs.",
      errorCode: "no_jobs",
      summaryMessage: "PrintFactory API returned no jobs in the sync window.",
    });
  }

  const now = new Date().toISOString();
  let imported = 0;
  let updated = 0;
  let parentJobsAutoMatched = 0;
  let parentJobSuggestions = 0;
  let itemSuggestions = 0;
  let errors = 0;

  try {
    const existingByGuid = await loadExistingByGuid(
      adminClient,
      apiJobs.map((job) => job.guid)
    );

    for (const apiJob of apiJobs) {
      try {
        const existing = existingByGuid.get(apiJob.guid);
        const { row, created } = await upsertPrintfactoryJob(
          adminClient,
          apiJob,
          existing,
          now
        );

        if (created) {
          imported += 1;
        } else {
          updated += 1;
        }

        const matchedRow = await applyJobMatchingIfNeeded(adminClient, row);
        const status = matchedRow.job_match_status as string;

        if (status === "matched_automatically" || status === "matched_manually") {
          parentJobsAutoMatched += 1;
        } else if (status === "suggested") {
          parentJobSuggestions += 1;
        }

        itemSuggestions += await createItemSuggestionsForJob(
          adminClient,
          matchedRow as Record<string, unknown>
        );

        const candidJobId = matchedRow.candid_job_id as string | null;

        if (candidJobId) {
          await refreshJobProductionReadiness(adminClient, candidJobId, actorProfileId);
        }
      } catch (jobError) {
        errors += 1;

        if (process.env.NODE_ENV === "development") {
          console.error("[printfactory-sync]", apiJob.guid, jobError);
        }
      }
    }

    const { data: allRecords } = await adminClient
      .from("printfactory_jobs")
      .select(`
        id,
        job_match_status,
        candid_job_id,
        suggested_candid_job_id,
        match_suggestion_reason,
        printfactory_job_manifest_items(link_status, match_confidence, suggestion_reason)
      `);

    const tabCounts = countPrintfactoryRecordsByTab(allRecords ?? []);
    const { count: confirmedLinksCount } = await adminClient
      .from("printfactory_job_manifest_items")
      .select("id", { count: "exact", head: true })
      .eq("link_status", "confirmed");

    const summaryMessage = buildSyncSummaryMessage({
      imported,
      updated,
      parentJobsAutoMatched,
      parentJobSuggestions,
      needsAttention: tabCounts.needs_attention,
    });

    await logPrintfactoryActivity(adminClient, {
      activityType: PRINTFACTORY_ACTIVITY_TYPES.syncCompleted,
      description: summaryMessage,
      actorProfileId,
      metadata: {
        imported,
        updated,
        parentJobsAutoMatched,
        parentJobSuggestions,
        itemSuggestions,
        confirmedLinks: confirmedLinksCount ?? 0,
        needsAttention: tabCounts.needs_attention,
        ignored: tabCounts.ignored,
        errors,
      },
    });

    return {
      ok: true,
      imported,
      updated,
      parentJobsAutoMatched,
      parentJobSuggestions,
      itemSuggestions,
      confirmedLinks: confirmedLinksCount ?? 0,
      needsAttention: tabCounts.needs_attention,
      ignored: tabCounts.ignored,
      errors,
      matched: parentJobsAutoMatched,
      unmatched: tabCounts.needs_attention,
      suggested: parentJobSuggestions,
      failed: errors,
      itemSuggestionsCreated: itemSuggestions,
      error: null,
      errorCode: null,
      connectionStatus,
      summaryMessage,
    };
  } catch (error) {
    if (isMissingPrintfactorySchemaError(error as { message?: string; code?: string })) {
      return emptyResult({
        error:
          "PrintFactory tables are missing. Apply supabase/migrations/20260803220000_printfactory_production_board_phase2.sql and 20260803230000_printfactory_matching_enhancements.sql",
        errorCode: "migration_required",
      });
    }

    return emptyResult({
      error: error instanceof Error ? error.message : "PrintFactory sync failed.",
      errorCode: "sync_failed",
    });
  }
}

export async function loadPrintfactoryMatchingRecords(
  adminClient: SupabaseClient,
  tab: ExceptionQueueTab
) {
  const { data, error } = await adminClient
    .from("printfactory_jobs")
    .select(`
    ${PRINTFACTORY_JOB_SELECT},
    jobs(id, job_reference, project_name, company_id, companies(company_name)),
    printfactory_job_manifest_items(
      id, production_item_id, link_status, match_method, match_confidence,
      suggestion_reason, suggestion_details, confirmed_at,
      production_items(id, item_reference, item_name)
    )
  `)
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (error) {
    if (isMissingPrintfactorySchemaError(error)) {
      return { records: [], schemaMissing: true as const, tabCounts: null };
    }

    throw error;
  }

  const allRecords = data ?? [];
  const tabCounts = countPrintfactoryRecordsByTab(allRecords);
  const records = filterPrintfactoryRecordsByTab(allRecords, tab);

  return { records, schemaMissing: false as const, tabCounts };
}
