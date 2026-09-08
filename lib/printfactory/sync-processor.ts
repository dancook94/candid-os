import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrintfactoryApiJob } from "@/lib/printfactory/client";
import type { JobMatchResult } from "@/lib/printfactory/job-matching";
import { shouldPreserveExistingJobMatch } from "@/lib/printfactory/job-matching";
import {
  loadJobMatchingContext,
  matchPrintfactoryJobWithContext,
} from "@/lib/printfactory/job-matching-context";
import { buildPrintfactoryMatchInput } from "@/lib/printfactory/match-input";
import {
  upsertPrintfactoryJobDocuments,
  upsertPrintfactoryJobDocumentsFromSourcePaths,
} from "@/lib/printfactory/documents-sync";
import { syncMultiJobLinksFromReferences } from "@/lib/printfactory/multi-job-links";
import type { PrintfactoryExistingSourcePathRow } from "@/lib/printfactory/source-path-enrichment";

type ExistingPrintfactoryRow = PrintfactoryExistingSourcePathRow & {
  id: string;
  candid_job_id: string | null;
  job_match_status: string;
  first_seen_at: string;
  normalized_source_path: string | null;
  source_locations: unknown;
  source_file_name: string | null;
  job_name: string | null;
  document_name: string | null;
  raw_metadata?: Record<string, unknown> | null;
};

function buildApiRow(
  apiJob: PrintfactoryApiJob,
  existing: ExistingPrintfactoryRow | undefined,
  now: string
) {
  return {
    printfactory_job_guid: apiJob.guid,
    job_name: apiJob.name,
    source_file_path: apiJob.sourceFilePath ?? existing?.source_file_path ?? null,
    normalized_source_path:
      apiJob.normalizedSourcePath ?? existing?.normalized_source_path ?? null,
    source_path_status: apiJob.sourcePathStatus ?? existing?.source_path_status ?? null,
    source_locations:
      apiJob.sourceLocations && apiJob.sourceLocations.length > 0
        ? apiJob.sourceLocations
        : (existing?.source_locations ?? null),
    source_file_name: apiJob.sourceFileName ?? existing?.source_file_name ?? null,
    document_name: apiJob.documentName ?? existing?.document_name ?? null,
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
}

function buildUpsertRow(
  apiJob: PrintfactoryApiJob,
  existing: ExistingPrintfactoryRow | undefined,
  now: string
) {
  // PostgREST bulk upsert uses one column list for the whole batch; omitted keys
  // become NULL in INSERT rows. Always send first_seen_at explicitly.
  return {
    ...buildApiRow(apiJob, existing, now),
    first_seen_at: existing?.first_seen_at ?? now,
  };
}

export async function loadExistingPrintfactoryRows(
  adminClient: SupabaseClient,
  guids: string[]
) {
  if (guids.length === 0) {
    return new Map<string, ExistingPrintfactoryRow>();
  }

  const map = new Map<string, ExistingPrintfactoryRow>();
  const chunkSize = 200;

  for (let index = 0; index < guids.length; index += chunkSize) {
    const chunk = guids.slice(index, index + chunkSize);
    const { data, error } = await adminClient
      .from("printfactory_jobs")
      .select(
        "id, printfactory_job_guid, candid_job_id, job_match_status, first_seen_at, source_file_path, normalized_source_path, source_path_status, source_locations, source_file_name, job_name, document_name, printfactory_status, updated_at_printfactory, raw_metadata"
      )
      .in("printfactory_job_guid", chunk);

    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      map.set(row.printfactory_job_guid as string, row as ExistingPrintfactoryRow);
    }
  }

  return map;
}

export async function batchUpsertPrintfactoryJobs(
  adminClient: SupabaseClient,
  apiJobs: PrintfactoryApiJob[],
  existingByGuid: Map<string, ExistingPrintfactoryRow>,
  now: string,
  batchSize: number
) {
  let imported = 0;
  let updated = 0;
  const rowByGuid = new Map<string, Record<string, unknown>>();

  for (let index = 0; index < apiJobs.length; index += batchSize) {
    const batch = apiJobs.slice(index, index + batchSize);
    const rows = batch.map((apiJob) => {
      const existing = existingByGuid.get(apiJob.guid);

      if (existing) {
        updated += 1;
      } else {
        imported += 1;
      }

      return buildUpsertRow(apiJob, existing, now);
    });

    const { data, error } = await adminClient
      .from("printfactory_jobs")
      .upsert(rows, { onConflict: "printfactory_job_guid" })
      .select(
        "id, printfactory_job_guid, candid_job_id, job_match_status, source_file_path, normalized_source_path, source_path_status, source_locations, source_file_name, job_name, document_name"
      );

    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      rowByGuid.set(row.printfactory_job_guid as string, row as Record<string, unknown>);

      const apiJob = batch.find((job) => job.guid === row.printfactory_job_guid);

      if (!apiJob) {
        continue;
      }

      if (apiJob.sourceLocations && apiJob.sourceLocations.length > 0) {
        await upsertPrintfactoryJobDocumentsFromSourcePaths(
          adminClient,
          row.id as string,
          apiJob.sourceLocations,
          apiJob.sourcePathStatus ?? null
        );
      } else if (apiJob.rawMetadata) {
        await upsertPrintfactoryJobDocuments(
          adminClient,
          row.id as string,
          apiJob.rawMetadata
        );
      }
    }
  }

  return { imported, updated, rowByGuid };
}

function toMatchUpdate(match: JobMatchResult) {
  return {
    candid_job_id: match.candidJobId,
    suggested_candid_job_id: match.suggestedCandidJobId,
    job_match_status: match.jobMatchStatus,
    job_match_method: match.jobMatchMethod,
    job_match_confidence: match.jobMatchConfidence,
    extracted_job_reference: match.extractedJobReference,
    match_suggestion_reason: match.matchSuggestionReason,
    match_suggestion_details: match.matchSuggestionDetails,
  };
}

export async function batchMatchPrintfactoryJobs(
  adminClient: SupabaseClient,
  rows: Record<string, unknown>[],
  batchSize: number
) {
  const context = await loadJobMatchingContext(adminClient);
  let parentJobsAutoMatched = 0;
  let parentJobSuggestions = 0;
  let skipped = 0;
  let updated = 0;

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);

    for (const row of batch) {
      const jobMatchStatus = row.job_match_status as string;

      if (shouldPreserveExistingJobMatch(jobMatchStatus)) {
        skipped += 1;
        continue;
      }

      const match = matchPrintfactoryJobWithContext(
        buildPrintfactoryMatchInput({
          source_file_path: row.source_file_path as string | null,
          normalized_source_path: row.normalized_source_path as string | null,
          source_locations: row.source_locations,
          source_file_name: row.source_file_name as string | null,
          job_name: row.job_name as string | null,
          document_name: row.document_name as string | null,
        }),
        context
      );

      if (
        process.env.NODE_ENV === "development" &&
        match.jobMatchStatus === "matched_automatically"
      ) {
        console.info("[printfactory] parent-auto-match", {
          printfactoryJobGuid: row.printfactory_job_guid,
          candidJobId: match.candidJobId,
          method: match.jobMatchMethod,
          reference: match.extractedJobReference,
        });
      }

      if (
        process.env.NODE_ENV === "development" &&
        match.jobMatchStatus === "conflict"
      ) {
        console.info("[printfactory] source-path-conflict", {
          printfactoryJobGuid: row.printfactory_job_guid,
          reference: match.extractedJobReference,
          details: match.matchSuggestionDetails,
        });
      }

      const { error } = await adminClient
        .from("printfactory_jobs")
        .update(toMatchUpdate(match))
        .eq("id", row.id);

      if (error) {
        throw error;
      }

      const linkedIds = match.matchSuggestionDetails?.linkedCandidJobIds;

      if (match.jobMatchStatus === "matched_automatically" && match.candidJobId) {
        const candidJobIds =
          Array.isArray(linkedIds) && linkedIds.length > 0
            ? (linkedIds as string[])
            : [match.candidJobId];

        await syncMultiJobLinksFromReferences(
          adminClient,
          row.id as string,
          candidJobIds,
          "automatic"
        );
      }

      updated += 1;

      if (match.jobMatchStatus === "matched_automatically") {
        parentJobsAutoMatched += 1;
      } else if (match.jobMatchStatus === "suggested") {
        parentJobSuggestions += 1;
      }
    }
  }

  return {
    parentJobsAutoMatched,
    parentJobSuggestions,
    skipped,
    updated,
  };
}

export type { ExistingPrintfactoryRow };
