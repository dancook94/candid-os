import { extractFilenameFromPath } from "@/lib/printfactory/job-reference-parser";

export type NormalizedPrintfactoryJob = {
  printfactoryJobGuid: string;
  jobName: string | null;
  sourceFilePath: string | null;
  sourceFileName: string | null;
  documentName: string | null;
  device: string | null;
  mediaType: string | null;
  mediaSize: string | null;
  producer: string | null;
  status: string | null;
  progress: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  rawMetadata: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstDocument(raw: Record<string, unknown>) {
  const documents = Array.isArray(raw.Documents)
    ? raw.Documents
    : Array.isArray(raw.documents)
      ? raw.documents
      : [];

  return documents.find(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object"
  );
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function pickProgress(raw: Record<string, unknown>): number | null {
  const progressRaw =
    raw.progress ??
    raw.Progress ??
    raw.percentComplete ??
    raw.PercentComplete;

  if (typeof progressRaw === "number" && Number.isFinite(progressRaw)) {
    return progressRaw;
  }

  if (typeof progressRaw === "string") {
    const parsed = Number.parseFloat(progressRaw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function pickPathFields(raw: Record<string, unknown>, document: Record<string, unknown> | undefined) {
  const pathCandidates = [
    raw.SourceFilePath,
    raw.sourceFilePath,
    raw.FilePath,
    raw.filePath,
    raw.Path,
    raw.path,
    raw.InputFile,
    raw.inputFile,
    raw.InputPath,
    raw.inputPath,
    raw.DocumentPath,
    raw.documentPath,
    raw.SourcePath,
    raw.sourcePath,
    raw.Folder,
    raw.folder,
    raw.Location,
    raw.location,
    document?.SourceFilePath,
    document?.FilePath,
    document?.Path,
    document?.InputPath,
    document?.DocumentPath,
    document?.Location,
    document?.location,
  ];

  for (const candidate of pathCandidates) {
    const value = pickString(candidate);

    if (value) {
      return value;
    }
  }

  return null;
}

/**
 * Single normalization entry point for PrintFactory list/detail records.
 * The v2 /job/list endpoint returns JobGUID, JobName, Documents[{Name}], Device, etc.
 * Original source paths come from GET /api/v2/job/{JobGUID} XML Document/Location.
 */
export function normalizePrintfactoryRawJob(
  raw: Record<string, unknown>
): NormalizedPrintfactoryJob | null {
  const guid = pickString(
    raw.JobGUID,
    raw.jobGUID,
    raw.Guid,
    raw.guid,
    raw.JobGuid,
    raw.jobGuid,
    raw.Id,
    raw.id
  );

  if (!guid) {
    return null;
  }

  const document = firstDocument(raw);
  const documentName = pickString(document?.Name, document?.name);
  const sourceFilePath = pickPathFields(raw, document);
  const sourceFileName =
    pickString(
      raw.SourceFileName,
      raw.sourceFileName,
      raw.FileName,
      raw.fileName,
      documentName
    ) ?? extractFilenameFromPath(sourceFilePath ?? "");

  const safeMetadata: Record<string, unknown> = {
    JobGUID: raw.JobGUID ?? raw.jobGUID ?? guid,
    JobName: raw.JobName ?? raw.jobName ?? null,
    Documents: raw.Documents ?? raw.documents ?? null,
    Device: raw.Device ?? raw.device ?? null,
    DeviceGUID: raw.DeviceGUID ?? raw.deviceGUID ?? null,
    MediaType: raw.MediaType ?? raw.mediaType ?? null,
    MediaSize: raw.MediaSize ?? raw.mediaSize ?? null,
    Status: raw.Status ?? raw.status ?? null,
    Producer: raw.Producer ?? raw.producer ?? null,
    CreatedDate: raw.CreatedDate ?? raw.createdDate ?? null,
    Progress: raw.Progress ?? raw.progress ?? null,
    sourcePathPresent: Boolean(sourceFilePath),
  };

  if (process.env.NODE_ENV === "development") {
    const pathAudit = [
      "SourceFilePath",
      "FilePath",
      "Path",
      "InputPath",
      "DocumentPath",
      "Folder",
    ].filter((key) => Boolean(raw[key] ?? document?.[key]));
    safeMetadata.pathFieldAudit = pathAudit;
  }

  return {
    printfactoryJobGuid: guid,
    jobName: pickString(raw.JobName, raw.jobName, raw.Name, raw.name),
    sourceFilePath,
    sourceFileName,
    documentName,
    device: pickString(raw.Device, raw.device, raw.DeviceName, raw.deviceName),
    mediaType: pickString(raw.MediaType, raw.mediaType),
    mediaSize: pickString(raw.MediaSize, raw.mediaSize),
    producer: pickString(raw.Producer, raw.producer),
    status: pickString(raw.Status, raw.status, raw.State, raw.state),
    progress: pickProgress(raw),
    createdAt: pickString(
      raw.CreatedDate,
      raw.createdDate,
      raw.CreatedAt,
      raw.createdAt
    ),
    updatedAt: pickString(
      raw.UpdatedDate,
      raw.updatedDate,
      raw.UpdatedAt,
      raw.updatedAt
    ),
    rawMetadata: safeMetadata,
  };
}

export function logRawPrintfactoryRecordsDev(rawRecords: Record<string, unknown>[]) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const sample = rawRecords.slice(0, 5).map((record, index) => {
    const document = firstDocument(record);
    const pathFields = [
      "SourceFilePath",
      "FilePath",
      "Path",
      "InputPath",
      "DocumentPath",
      "Folder",
      "Location",
    ].flatMap((key) => {
      const values: string[] = [];
      if (typeof record[key] === "string") values.push(`${key}=${record[key]}`);
      if (document && typeof document[key] === "string") {
        values.push(`Documents.${key}=${document[key]}`);
      }
      return values;
    });

    return {
      index,
      keys: Object.keys(record),
      documentKeys: document ? Object.keys(document) : [],
      guid: record.JobGUID ?? record.jobGUID ?? record.Guid ?? record.guid,
      jobName: record.JobName ?? record.jobName,
      documentName: document?.Name ?? document?.name ?? null,
      status: record.Status ?? record.status,
      pathFields,
    };
  });

  console.info("[printfactory] raw-record-audit", { sample });
}
