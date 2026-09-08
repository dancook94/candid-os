import type { PrintfactoryApiJob } from "@/lib/printfactory/client";
import { fetchPrintfactoryJobDetail } from "@/lib/printfactory/job-detail";
import {
  mergeRippedOutputPageCountIntoMetadata,
  readRippedOutputPageCountFromMetadata,
  type RippedOutputPageCountResult,
} from "@/lib/printfactory/output-page-count";
import {
  collectJobReferencesFromLocations,
  joinNormalizedLocations,
  pickPrimarySourceLocation,
  resolveSourceFileName,
  type PrintfactorySourceLocation,
  type PrintfactorySourcePathStatus,
} from "@/lib/printfactory/source-path";

export type PrintfactoryExistingSourcePathRow = {
  printfactory_job_guid: string;
  source_file_path: string | null;
  source_path_status: string | null;
  printfactory_status: string | null;
  updated_at_printfactory: string | null;
  raw_metadata?: Record<string, unknown> | null;
};

export type PrintfactorySourcePathEnrichment = {
  sourcePathStatus: PrintfactorySourcePathStatus;
  sourceFilePath: string | null;
  normalizedSourcePath: string | null;
  sourceLocations: PrintfactorySourceLocation[];
  sourceFileName: string | null;
  detailErrorMessage: string | null;
};

export type EnrichPrintfactoryJobsResult = {
  enrichedJobs: PrintfactoryApiJob[];
  detailFetchCount: number;
  detailFetchFailures: number;
  detailFetchSkipped: number;
};

function readConcurrencyLimit() {
  const parsed = Number.parseInt(
    process.env.PRINTFACTORY_DETAIL_FETCH_CONCURRENCY ?? "",
    10
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export function shouldFetchPrintfactoryJobDetail(
  apiJob: PrintfactoryApiJob,
  existing: PrintfactoryExistingSourcePathRow | undefined
) {
  if (!existing) {
    return true;
  }

  if (existing.source_path_status !== "found") {
    return true;
  }

  if (!existing.source_file_path) {
    return true;
  }

  if (
    apiJob.status &&
    existing.printfactory_status &&
    apiJob.status !== existing.printfactory_status
  ) {
    return true;
  }

  if (
    apiJob.updatedAt &&
    existing.updated_at_printfactory &&
    apiJob.updatedAt !== existing.updated_at_printfactory
  ) {
    return true;
  }

  if (!readRippedOutputPageCountFromMetadata(existing.raw_metadata)) {
    return true;
  }

  return false;
}

function buildEnrichmentFromDetail(
  detail: Awaited<ReturnType<typeof fetchPrintfactoryJobDetail>>,
  apiJob: PrintfactoryApiJob,
  existing: PrintfactoryExistingSourcePathRow | undefined
): PrintfactorySourcePathEnrichment {
  if (detail.status === "found") {
    const primary = pickPrimarySourceLocation(detail.locations);
    const references = collectJobReferencesFromLocations(detail.locations);

    if (process.env.NODE_ENV === "development" && references.length > 0) {
      console.info("[printfactory] extracted-job-reference", {
        jobGuid: apiJob.guid,
        references,
      });
    }

    return {
      sourcePathStatus: "found",
      sourceFilePath: primary?.rawLocation ?? null,
      normalizedSourcePath: primary?.normalizedLocation ?? null,
      sourceLocations: detail.locations,
      sourceFileName: resolveSourceFileName(primary, apiJob.documentName),
      detailErrorMessage: null,
    };
  }

  const preserveExisting =
    existing?.source_path_status === "found" && existing.source_file_path;

  if (preserveExisting) {
    return {
      sourcePathStatus: "found",
      sourceFilePath: existing.source_file_path,
      normalizedSourcePath: null,
      sourceLocations: [],
      sourceFileName: apiJob.sourceFileName,
      detailErrorMessage: detail.errorMessage,
    };
  }

  return {
    sourcePathStatus: detail.status,
    sourceFilePath: null,
    normalizedSourcePath: null,
    sourceLocations: [],
    sourceFileName: apiJob.sourceFileName,
    detailErrorMessage: detail.errorMessage,
  };
}

function applyEnrichment(
  apiJob: PrintfactoryApiJob,
  enrichment: PrintfactorySourcePathEnrichment,
  detail?: Awaited<ReturnType<typeof fetchPrintfactoryJobDetail>>
): PrintfactoryApiJob {
  const joinedPaths = joinNormalizedLocations(enrichment.sourceLocations);
  const outputPageResult: RippedOutputPageCountResult | null =
    detail?.rippedOutputPageCount && detail.rippedOutputPageCountSource
      ? {
          rippedOutputPageCount: detail.rippedOutputPageCount,
          rippedOutputPageNumbers: detail.rippedOutputPageNumbers,
          rippedOutputPageCountSource: detail.rippedOutputPageCountSource,
        }
      : null;

  return {
    ...apiJob,
    sourceFilePath: enrichment.sourceFilePath,
    sourceFileName: enrichment.sourceFileName ?? apiJob.sourceFileName,
    sourcePathStatus: enrichment.sourcePathStatus,
    normalizedSourcePath: enrichment.normalizedSourcePath,
    sourceLocations: enrichment.sourceLocations,
    sourcePathErrorMessage: enrichment.detailErrorMessage,
    rawMetadata: mergeRippedOutputPageCountIntoMetadata(
      {
        ...(apiJob.rawMetadata ?? {}),
        sourcePathStatus: enrichment.sourcePathStatus,
        sourcePathErrorMessage: enrichment.detailErrorMessage,
        sourceLocationCount: enrichment.sourceLocations.length,
        sourcePathsForMatch: joinedPaths || enrichment.normalizedSourcePath,
      },
      outputPageResult
    ),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker()
  );

  await Promise.all(workers);
  return results;
}

export async function enrichPrintfactoryJobsWithSourcePaths(
  apiJobs: PrintfactoryApiJob[],
  existingByGuid: Map<string, PrintfactoryExistingSourcePathRow>,
  token: string
): Promise<EnrichPrintfactoryJobsResult> {
  const concurrency = readConcurrencyLimit();
  const jobsToFetch = apiJobs.filter((job) =>
    shouldFetchPrintfactoryJobDetail(job, existingByGuid.get(job.guid))
  );

  const detailByGuid = new Map<
    string,
    Awaited<ReturnType<typeof fetchPrintfactoryJobDetail>>
  >();

  if (jobsToFetch.length > 0) {
    await mapWithConcurrency(jobsToFetch, concurrency, async (job) => {
      const detail = await fetchPrintfactoryJobDetail(job.guid, token);
      detailByGuid.set(job.guid, detail);
    });
  }

  let detailFetchFailures = 0;
  const detailFailureBreakdown: Record<string, number> = {};

  const enrichedJobs = apiJobs.map((apiJob) => {
    const existing = existingByGuid.get(apiJob.guid);
    const detail = detailByGuid.get(apiJob.guid);

    if (!detail) {
      if (existing?.source_path_status === "found" && existing.source_file_path) {
        return applyEnrichment(apiJob, {
          sourcePathStatus: "found",
          sourceFilePath: existing.source_file_path,
          normalizedSourcePath: null,
          sourceLocations: [],
          sourceFileName: apiJob.sourceFileName,
          detailErrorMessage: null,
        });
      }

      return apiJob;
    }

    if (detail.status !== "found") {
      detailFetchFailures += 1;
      detailFailureBreakdown[detail.status] =
        (detailFailureBreakdown[detail.status] ?? 0) + 1;
    }

    return applyEnrichment(
      apiJob,
      buildEnrichmentFromDetail(detail, apiJob, existing),
      detail
    );
  });

  if (
    process.env.NODE_ENV === "development" &&
    detailFetchFailures > 0
  ) {
    console.info("[printfactory] detail-fetch-failures", {
      total: detailFetchFailures,
      breakdown: detailFailureBreakdown,
    });
  }

  return {
    enrichedJobs,
    detailFetchCount: jobsToFetch.length,
    detailFetchFailures,
    detailFetchSkipped: apiJobs.length - jobsToFetch.length,
  };
}
