import type { SupabaseClient } from "@supabase/supabase-js";

import { isPrintFactoryJobRipped } from "@/lib/printfactory/ripped";
import { buildPrintfactoryThumbnailProxyPath } from "@/lib/printfactory/thumbnail";

const MATCHED_JOB_STATUSES = ["matched_automatically", "matched_manually"] as const;

export type PrintfactoryJobPreviewRecord = {
  id: string;
  printfactory_job_guid: string;
  job_name: string | null;
  document_name: string | null;
  source_file_name: string | null;
  device: string | null;
  media_type: string | null;
  printfactory_status: string | null;
  progress: number | null;
  job_match_status: string;
  ignored_at: string | null;
  last_seen_at: string | null;
  updated_at_printfactory: string | null;
  candid_job_id: string | null;
  is_multi_job_sheet?: boolean | null;
};

export type PrintfactoryLinkedJobSummary = {
  id: string;
  jobReference: string;
  projectName: string;
};

export type PrintfactoryJobPreview = {
  id: string;
  jobGuid: string;
  jobName: string | null;
  fileName: string | null;
  device: string | null;
  mediaType: string | null;
  printfactoryStatus: string | null;
  progress: number | null;
  isRipped: boolean;
  thumbnailUrl: string;
  lastSeenAt: string | null;
  isSharedPrint: boolean;
  linkedJobCount: number;
  otherLinkedJobs: PrintfactoryLinkedJobSummary[];
};

export type JobPrintfactoryPreviewBundle = {
  primary: PrintfactoryJobPreview | null;
  previews: PrintfactoryJobPreview[];
};

const PREVIEW_SELECT =
  "id, printfactory_job_guid, job_name, document_name, source_file_name, device, media_type, printfactory_status, progress, job_match_status, ignored_at, last_seen_at, updated_at_printfactory, candid_job_id, is_multi_job_sheet";

function resolvePreviewTimestamp(record: PrintfactoryJobPreviewRecord) {
  return record.last_seen_at ?? record.updated_at_printfactory ?? "";
}

function toPreviewRecord(
  row: PrintfactoryJobPreviewRecord,
  linkSummaries: PrintfactoryLinkedJobSummary[],
  viewingJobId: string
): PrintfactoryJobPreview {
  const isRipped = isPrintFactoryJobRipped(row);
  const linkedJobCount = Math.max(linkSummaries.length, row.candid_job_id ? 1 : 0);

  return {
    id: row.id,
    jobGuid: row.printfactory_job_guid,
    jobName: row.job_name,
    fileName: row.document_name ?? row.source_file_name,
    device: row.device,
    mediaType: row.media_type,
    printfactoryStatus: row.printfactory_status,
    progress: row.progress,
    isRipped,
    thumbnailUrl: isRipped
      ? buildPrintfactoryThumbnailProxyPath(row.printfactory_job_guid)
      : "",
    lastSeenAt: resolvePreviewTimestamp(row),
    isSharedPrint: linkedJobCount > 1 || Boolean(row.is_multi_job_sheet),
    linkedJobCount,
    otherLinkedJobs: linkSummaries.filter((link) => link.id !== viewingJobId),
  };
}

function isEligibleMatchedRecord(record: PrintfactoryJobPreviewRecord) {
  return (
    MATCHED_JOB_STATUSES.includes(
      record.job_match_status as (typeof MATCHED_JOB_STATUSES)[number]
    ) && !record.ignored_at
  );
}

function sortPreviewCandidates(a: PrintfactoryJobPreviewRecord, b: PrintfactoryJobPreviewRecord) {
  const aRipped = isPrintFactoryJobRipped(a);
  const bRipped = isPrintFactoryJobRipped(b);

  if (aRipped !== bRipped) {
    return aRipped ? -1 : 1;
  }

  return resolvePreviewTimestamp(b).localeCompare(resolvePreviewTimestamp(a));
}

function buildBundle(
  records: PrintfactoryJobPreviewRecord[],
  linkMap: Map<string, PrintfactoryLinkedJobSummary[]>,
  viewingJobId: string
): JobPrintfactoryPreviewBundle {
  const eligible = records.filter(isEligibleMatchedRecord).sort(sortPreviewCandidates);
  const ripped = eligible
    .map((record) =>
      toPreviewRecord(record, linkMap.get(record.id) ?? [], viewingJobId)
    )
    .filter((preview) => preview.isRipped && preview.thumbnailUrl);

  return {
    primary: ripped[0] ?? null,
    previews: ripped,
  };
}

async function loadLinkedJobSummariesByPrintfactoryJobId(
  adminClient: SupabaseClient,
  printfactoryJobIds: string[]
): Promise<Map<string, PrintfactoryLinkedJobSummary[]>> {
  const linkMap = new Map<string, PrintfactoryLinkedJobSummary[]>();

  if (printfactoryJobIds.length === 0) {
    return linkMap;
  }

  const { data, error } = await adminClient
    .from("printfactory_job_candid_jobs")
    .select("printfactory_job_id, jobs(id, job_reference, project_name)")
    .in("printfactory_job_id", printfactoryJobIds);

  if (error) {
    if (error.code === "42P01") {
      return linkMap;
    }

    throw error;
  }

  for (const row of data ?? []) {
    const pfJobId = row.printfactory_job_id as string;
    const jobRaw = row.jobs as unknown;
    const job = (Array.isArray(jobRaw) ? jobRaw[0] : jobRaw) as
      | { id: string; job_reference: string; project_name: string }
      | null
      | undefined;

    if (!job?.id) {
      continue;
    }

    const existing = linkMap.get(pfJobId) ?? [];
    existing.push({
      id: job.id,
      jobReference: job.job_reference,
      projectName: job.project_name,
    });
    linkMap.set(pfJobId, existing);
  }

  return linkMap;
}

export async function loadPrintfactoryPreviewsForJobIds(
  adminClient: SupabaseClient,
  jobIds: string[]
): Promise<Map<string, JobPrintfactoryPreviewBundle>> {
  const bundles = new Map<string, JobPrintfactoryPreviewBundle>();

  if (jobIds.length === 0) {
    return bundles;
  }

  for (const jobId of jobIds) {
    bundles.set(jobId, { primary: null, previews: [] });
  }

  const [{ data: directRows, error: directError }, { data: linkRows, error: linkError }] =
    await Promise.all([
      adminClient
        .from("printfactory_jobs")
        .select(PREVIEW_SELECT)
        .in("candid_job_id", jobIds)
        .in("job_match_status", [...MATCHED_JOB_STATUSES]),
      adminClient
        .from("printfactory_job_candid_jobs")
        .select(`candid_job_id, printfactory_jobs!inner(${PREVIEW_SELECT})`)
        .in("candid_job_id", jobIds),
    ]);

  if (directError && directError.code !== "42P01") {
    throw directError;
  }

  if (linkError && linkError.code !== "42P01") {
    throw linkError;
  }

  const recordsByJob = new Map<string, Map<string, PrintfactoryJobPreviewRecord>>();

  for (const jobId of jobIds) {
    recordsByJob.set(jobId, new Map());
  }

  for (const row of directRows ?? []) {
    const jobId = row.candid_job_id as string | null;

    if (!jobId || !recordsByJob.has(jobId)) {
      continue;
    }

    recordsByJob.get(jobId)!.set(row.id as string, row as PrintfactoryJobPreviewRecord);
  }

  for (const link of linkRows ?? []) {
    const jobId = link.candid_job_id as string;
    const pfRaw = link.printfactory_jobs as unknown;
    const pfRow = (Array.isArray(pfRaw) ? pfRaw[0] : pfRaw) as
      | PrintfactoryJobPreviewRecord
      | null
      | undefined;

    if (!pfRow?.id || !recordsByJob.has(jobId)) {
      continue;
    }

    recordsByJob.get(jobId)!.set(pfRow.id, pfRow);
  }

  const allPfJobIds = new Set<string>();

  for (const recordMap of recordsByJob.values()) {
    for (const pfId of recordMap.keys()) {
      allPfJobIds.add(pfId);
    }
  }

  const linkMap = await loadLinkedJobSummariesByPrintfactoryJobId(
    adminClient,
    [...allPfJobIds]
  );

  for (const [jobId, recordMap] of recordsByJob) {
    bundles.set(jobId, buildBundle([...recordMap.values()], linkMap, jobId));
  }

  return bundles;
}

export async function loadPrintfactoryPreviewsForJob(
  adminClient: SupabaseClient,
  jobId: string
): Promise<JobPrintfactoryPreviewBundle> {
  const bundles = await loadPrintfactoryPreviewsForJobIds(adminClient, [jobId]);
  return bundles.get(jobId) ?? { primary: null, previews: [] };
}
