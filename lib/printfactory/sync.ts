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
import {
  logPrintfactoryActivity,
} from "@/lib/printfactory/activity";
import {
  matchPrintfactoryJobToCandidJob,
  shouldPreserveExistingJobMatch,
} from "@/lib/printfactory/job-matching";
import {
  suggestManifestItemMatches,
  type ManifestItemMatchCandidate,
} from "@/lib/printfactory/item-matching";
import { MANIFEST_ITEM_SELECT } from "@/lib/manifest/constants";
import { refreshJobProductionReadiness } from "@/lib/printfactory/readiness-service";

export type PrintfactorySyncResult = {
  ok: boolean;
  imported: number;
  updated: number;
  matched: number;
  unmatched: number;
  suggested: number;
  failed: number;
  itemSuggestionsCreated: number;
  error: string | null;
  errorCode: string | null;
  connectionStatus: ReturnType<typeof getPrintfactoryConnectionStatus>;
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
    device: apiJob.device,
    media_type: apiJob.mediaType,
    producer: apiJob.producer,
    printfactory_status: apiJob.status,
    progress: apiJob.progress,
    created_at_printfactory: apiJob.createdAt,
    updated_at_printfactory: apiJob.updatedAt,
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
    source_file_path: row.source_file_path as string | null,
    job_name: row.job_name as string | null,
    source_file_name: row.source_file_name as string | null,
  });

  const { data, error } = await adminClient
    .from("printfactory_jobs")
    .update({
      candid_job_id: match.candidJobId,
      job_match_status: match.jobMatchStatus,
      job_match_method: match.jobMatchMethod,
      job_match_confidence: match.jobMatchConfidence,
      extracted_job_reference: match.extractedJobReference,
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function createItemSuggestionsForJob(
  adminClient: SupabaseClient,
  printfactoryJob: Record<string, unknown>
) {
  const candidJobId = printfactoryJob.candid_job_id as string | null;
  const printfactoryJobId = printfactoryJob.id as string;

  if (!candidJobId) {
    return 0;
  }

  const matchStatus = printfactoryJob.job_match_status as string;

  if (matchStatus === "ignored" || matchStatus === "unmatched" || matchStatus === "conflict") {
    return 0;
  }

  const { data: manifestItems, error: manifestError } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("job_id", candidJobId)
    .is("deleted_at", null);

  if (manifestError) {
    throw manifestError;
  }

  const { data: confirmedLinks, error: linksError } = await adminClient
    .from("printfactory_job_manifest_items")
    .select("production_item_id, printfactory_jobs!inner(source_file_name)")
    .eq("link_status", "confirmed");

  if (linksError && linksError.code !== "42P01") {
    throw linksError;
  }

  const priorPatterns = (confirmedLinks ?? []).map((link) => ({
    productionItemId: link.production_item_id as string,
    filenamePattern:
      ((link.printfactory_jobs as { source_file_name?: string | null })
        ?.source_file_name ?? "") || "",
  }));

  const suggestions = suggestManifestItemMatches(
    {
      source_file_path: printfactoryJob.source_file_path as string | null,
      source_file_name: printfactoryJob.source_file_name as string | null,
      job_name: printfactoryJob.job_name as string | null,
      media_type: printfactoryJob.media_type as string | null,
    },
    (manifestItems ?? []) as ManifestItemMatchCandidate[],
    priorPatterns
  );

  let created = 0;

  for (const suggestion of suggestions.slice(0, 5)) {
    const { data: existingLink } = await adminClient
      .from("printfactory_job_manifest_items")
      .select("id, link_status")
      .eq("printfactory_job_id", printfactoryJobId)
      .eq("production_item_id", suggestion.productionItemId)
      .maybeSingle();

    if (existingLink?.link_status === "confirmed") {
      continue;
    }

    const { error } = await adminClient
      .from("printfactory_job_manifest_items")
      .upsert(
        {
          printfactory_job_id: printfactoryJobId,
          production_item_id: suggestion.productionItemId,
          link_status: "suggested",
          match_method: suggestion.matchMethod,
          match_confidence: suggestion.confidence,
        },
        { onConflict: "printfactory_job_id,production_item_id" }
      );

    if (error) {
      throw error;
    }

    created += 1;
  }

  return created;
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
    matched: 0,
    unmatched: 0,
    suggested: 0,
    failed: 0,
    itemSuggestionsCreated: 0,
    error: null,
    errorCode: null,
    connectionStatus,
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
    });
  }

  const now = new Date().toISOString();
  let imported = 0;
  let updated = 0;
  let matched = 0;
  let unmatched = 0;
  let suggested = 0;
  let failed = 0;
  let itemSuggestionsCreated = 0;

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

        if (
          status === "matched_automatically" ||
          status === "matched_manually"
        ) {
          matched += 1;
        } else if (status === "suggested") {
          suggested += 1;
        } else if (status === "unmatched" || status === "conflict") {
          unmatched += 1;
        }

        itemSuggestionsCreated += await createItemSuggestionsForJob(
          adminClient,
          matchedRow as Record<string, unknown>
        );

        const candidJobId = matchedRow.candid_job_id as string | null;

        if (candidJobId) {
          await refreshJobProductionReadiness(adminClient, candidJobId, actorProfileId);
        }
      } catch (jobError) {
        failed += 1;

        if (process.env.NODE_ENV === "development") {
          console.error("[printfactory-sync]", apiJob.guid, jobError);
        }
      }
    }

    await logPrintfactoryActivity(adminClient, {
      activityType: PRINTFACTORY_ACTIVITY_TYPES.syncCompleted,
      description: `PrintFactory sync completed: ${imported} imported, ${updated} updated, ${matched} matched.`,
      actorProfileId,
      metadata: {
        imported,
        updated,
        matched,
        unmatched,
        suggested,
        failed,
        itemSuggestionsCreated,
      },
    });

    return {
      ok: true,
      imported,
      updated,
      matched,
      unmatched,
      suggested,
      failed,
      itemSuggestionsCreated,
      error: null,
      errorCode: null,
      connectionStatus,
    };
  } catch (error) {
    if (isMissingPrintfactorySchemaError(error as { message?: string; code?: string })) {
      return emptyResult({
        error:
          "PrintFactory tables are missing. Apply supabase/migrations/20260803220000_printfactory_production_board_phase2.sql",
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
  tab: "needs_job_match" | "needs_item_match" | "confirmed" | "ignored"
) {
  let query = adminClient.from("printfactory_jobs").select(`
    ${PRINTFACTORY_JOB_SELECT},
    jobs(id, job_reference, project_name, company_id, companies(company_name)),
    printfactory_job_manifest_items(
      ${"id, production_item_id, link_status, match_method, match_confidence, confirmed_at, production_items(id, item_reference, item_name)"}
    )
  `);

  switch (tab) {
    case "needs_job_match":
      query = query.in("job_match_status", ["unmatched", "suggested", "conflict"]);
      break;
    case "needs_item_match":
      query = query
        .in("job_match_status", [
          "matched_automatically",
          "matched_manually",
          "suggested",
        ])
        .is("ignored_at", null);
      break;
    case "confirmed":
      query = query.in("job_match_status", [
        "matched_automatically",
        "matched_manually",
      ]);
      break;
    case "ignored":
      query = query.eq("job_match_status", "ignored");
      break;
  }

  const { data, error } = await query
    .order("last_seen_at", { ascending: false })
    .limit(200);

  if (error) {
    if (isMissingPrintfactorySchemaError(error)) {
      return { records: [], schemaMissing: true as const };
    }

    throw error;
  }

  return { records: data ?? [], schemaMissing: false as const };
}
