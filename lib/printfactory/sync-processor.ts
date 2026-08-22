import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrintfactoryApiJob } from "@/lib/printfactory/client";
import type { JobMatchResult } from "@/lib/printfactory/job-matching";
import { shouldPreserveExistingJobMatch } from "@/lib/printfactory/job-matching";
import {
  loadJobMatchingContext,
  matchPrintfactoryJobWithContext,
} from "@/lib/printfactory/job-matching-context";
import { upsertPrintfactoryJobDocuments } from "@/lib/printfactory/documents-sync";
import { syncMultiJobLinksFromReferences } from "@/lib/printfactory/multi-job-links";

type ExistingPrintfactoryRow = {
  id: string;
  printfactory_job_guid: string;
  candid_job_id: string | null;
  job_match_status: string;
  source_file_path: string | null;
  source_file_name: string | null;
  job_name: string | null;
  document_name: string | null;
};

function buildApiRow(apiJob: PrintfactoryApiJob, now: string) {
  return {
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
        "id, printfactory_job_guid, candid_job_id, job_match_status, source_file_path, source_file_name, job_name, document_name"
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

      return {
        ...buildApiRow(apiJob, now),
        ...(existing ? {} : { first_seen_at: now }),
      };
    });

    const { data, error } = await adminClient
      .from("printfactory_jobs")
      .upsert(rows, { onConflict: "printfactory_job_guid" })
      .select(
        "id, printfactory_job_guid, candid_job_id, job_match_status, source_file_path, source_file_name, job_name, document_name"
      );

    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      rowByGuid.set(row.printfactory_job_guid as string, row as Record<string, unknown>);

      const apiJob = batch.find((job) => job.guid === row.printfactory_job_guid);

      if (apiJob?.rawMetadata) {
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
        {
          sourceFilePath: row.source_file_path as string | null,
          sourceFileName: row.source_file_name as string | null,
          jobName: row.job_name as string | null,
          documentName: row.document_name as string | null,
        },
        context
      );

      const { error } = await adminClient
        .from("printfactory_jobs")
        .update(toMatchUpdate(match))
        .eq("id", row.id);

      if (error) {
        throw error;
      }

      const linkedIds = match.matchSuggestionDetails?.linkedCandidJobIds;

      if (
        Array.isArray(linkedIds) &&
        linkedIds.length > 1 &&
        match.jobMatchStatus === "matched_automatically"
      ) {
        await syncMultiJobLinksFromReferences(
          adminClient,
          row.id as string,
          linkedIds as string[],
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
