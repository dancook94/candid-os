import type { PrintfactoryReferenceSearchInput } from "@/lib/printfactory/job-reference-parser";
import type { PrintfactorySourceLocation } from "@/lib/printfactory/source-path";
import { joinNormalizedLocations } from "@/lib/printfactory/source-path";

type PrintfactoryMatchInputRow = {
  source_file_path: string | null;
  normalized_source_path?: string | null;
  source_locations?: unknown;
  source_file_name: string | null;
  job_name: string | null;
  document_name: string | null;
};

function parseSourceLocations(value: unknown): PrintfactorySourceLocation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is PrintfactorySourceLocation =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as PrintfactorySourceLocation).normalizedLocation === "string"
  );
}

export function buildPrintfactoryMatchInput(
  row: PrintfactoryMatchInputRow
): PrintfactoryReferenceSearchInput {
  const locations = parseSourceLocations(row.source_locations);
  const joinedLocations = joinNormalizedLocations(locations);
  const normalizedPath =
    row.normalized_source_path?.trim() ||
    joinedLocations ||
    row.source_file_path?.replace(/\\/g, "/") ||
    null;

  return {
    sourceFilePath: normalizedPath,
    sourceFileName: row.source_file_name,
    jobName: row.job_name,
    documentName: row.document_name,
  };
}

export function buildPrintfactoryMatchInputFromApiJob(job: {
  sourceFilePath: string | null;
  normalizedSourcePath?: string | null;
  sourceLocations?: PrintfactorySourceLocation[];
  sourceFileName: string | null;
  name: string | null;
  documentName: string | null;
}): PrintfactoryReferenceSearchInput {
  const joinedLocations = joinNormalizedLocations(job.sourceLocations ?? []);

  return {
    sourceFilePath:
      job.normalizedSourcePath?.trim() ||
      joinedLocations ||
      job.sourceFilePath?.replace(/\\/g, "/") ||
      null,
    sourceFileName: job.sourceFileName,
    jobName: job.name,
    documentName: job.documentName,
  };
}
