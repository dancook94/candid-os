import type { SupabaseClient } from "@supabase/supabase-js";

import {
  extractFilenameFromPath,
  extractItemReferenceFromText,
  extractJobReferencesFromText,
} from "@/lib/printfactory/job-reference-parser";
import type {
  PrintfactorySourceLocation,
  PrintfactorySourcePathStatus,
} from "@/lib/printfactory/source-path";

type DocumentInput = {
  Name?: string;
  name?: string;
  GUID?: string;
  guid?: string;
  SourceFilePath?: string;
  FilePath?: string;
  Path?: string;
  Location?: string;
  Width?: number;
  Height?: number;
  width?: number;
  height?: number;
};

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function buildDocumentRow(input: {
  printfactoryJobId: string;
  documentGuid: string | null;
  documentName: string | null;
  sourcePath: string | null;
  normalizedSourcePath: string | null;
  sourcePathStatus: PrintfactorySourcePathStatus | null;
  rawMetadata: Record<string, unknown>;
  widthMm?: number | null;
  heightMm?: number | null;
}) {
  const sourceFileName =
    extractFilenameFromPath(input.sourcePath ?? "") ??
    extractFilenameFromPath(input.normalizedSourcePath ?? "") ??
    input.documentName;
  const searchText = [
    input.sourcePath,
    input.normalizedSourcePath,
    sourceFileName,
    input.documentName,
  ]
    .filter(Boolean)
    .join(" ");
  const jobRefs = extractJobReferencesFromText(searchText);
  const itemRef = extractItemReferenceFromText(searchText);
  const widthMm = input.widthMm ?? null;
  const heightMm = input.heightMm ?? null;
  const areaSqm =
    widthMm && heightMm ? Number(((widthMm * heightMm) / 1_000_000).toFixed(4)) : null;

  return {
    printfactory_job_id: input.printfactoryJobId,
    document_guid: input.documentGuid,
    document_name: input.documentName,
    source_file_path: input.sourcePath,
    normalized_source_file_path: input.normalizedSourcePath,
    source_path_status: input.sourcePathStatus,
    source_file_name: sourceFileName,
    width_mm: widthMm,
    height_mm: heightMm,
    area_sqm: areaSqm,
    raw_metadata: input.rawMetadata,
    extracted_job_reference: jobRefs[0] ?? null,
    extracted_item_reference: itemRef,
    updated_at: new Date().toISOString(),
  };
}

async function upsertDocumentRow(
  adminClient: SupabaseClient,
  row: ReturnType<typeof buildDocumentRow>
) {
  if (row.document_guid) {
    const { error } = await adminClient
      .from("printfactory_job_documents")
      .upsert(row, { onConflict: "printfactory_job_id,document_guid" });

    if (error) {
      if (error.code === "42P01") {
        return { upserted: 0, schemaMissing: true as const };
      }

      throw error;
    }

    return { upserted: 1 };
  }

  const { error } = await adminClient.from("printfactory_job_documents").insert(row);

  if (error) {
    if (error.code === "42P01") {
      return { upserted: 0, schemaMissing: true as const };
    }

    throw error;
  }

  return { upserted: 1 };
}

export async function upsertPrintfactoryJobDocumentsFromSourcePaths(
  adminClient: SupabaseClient,
  printfactoryJobId: string,
  locations: PrintfactorySourceLocation[],
  sourcePathStatus: PrintfactorySourcePathStatus | null
) {
  if (locations.length === 0) {
    return { upserted: 0 };
  }

  let upserted = 0;

  for (const location of locations) {
    const row = buildDocumentRow({
      printfactoryJobId,
      documentGuid: location.documentGuid,
      documentName: location.documentName,
      sourcePath: location.rawLocation,
      normalizedSourcePath: location.normalizedLocation,
      sourcePathStatus: sourcePathStatus ?? "found",
      rawMetadata: location as unknown as Record<string, unknown>,
    });

    const result = await upsertDocumentRow(adminClient, row);

    if ("schemaMissing" in result && result.schemaMissing) {
      return result;
    }

    upserted += result.upserted;
  }

  return { upserted };
}

export async function upsertPrintfactoryJobDocuments(
  adminClient: SupabaseClient,
  printfactoryJobId: string,
  rawMetadata: Record<string, unknown> | null | undefined
) {
  const documents = Array.isArray(rawMetadata?.Documents)
    ? rawMetadata.Documents
    : Array.isArray(rawMetadata?.documents)
      ? rawMetadata.documents
      : [];

  if (documents.length === 0) {
    return { upserted: 0 };
  }

  let upserted = 0;

  for (const entry of documents) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const doc = entry as DocumentInput;
    const documentName = pickString(doc.Name, doc.name);
    const documentGuid = pickString(doc.GUID, doc.guid);
    const sourcePath = pickString(
      doc.Location,
      doc.SourceFilePath,
      doc.FilePath,
      doc.Path
    );
    const widthMm = pickNumber(doc.Width, doc.width);
    const heightMm = pickNumber(doc.Height, doc.height);

    const row = buildDocumentRow({
      printfactoryJobId,
      documentGuid,
      documentName,
      sourcePath,
      normalizedSourcePath: sourcePath?.replace(/\\/g, "/") ?? null,
      sourcePathStatus: sourcePath ? "found" : null,
      rawMetadata: doc as Record<string, unknown>,
      widthMm,
      heightMm,
    });

    const result = await upsertDocumentRow(adminClient, row);

    if ("schemaMissing" in result && result.schemaMissing) {
      return result;
    }

    upserted += result.upserted;
  }

  return { upserted };
}
