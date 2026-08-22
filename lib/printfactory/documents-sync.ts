import type { SupabaseClient } from "@supabase/supabase-js";

import {
  extractItemReferenceFromText,
  extractJobReferencesFromText,
} from "@/lib/printfactory/job-reference-parser";

type DocumentInput = {
  Name?: string;
  name?: string;
  GUID?: string;
  guid?: string;
  SourceFilePath?: string;
  FilePath?: string;
  Path?: string;
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
    const sourcePath = pickString(doc.SourceFilePath, doc.FilePath, doc.Path);
    const sourceFileName = sourcePath?.split(/[/\\]/).pop() ?? documentName;
    const widthMm = pickNumber(doc.Width, doc.width);
    const heightMm = pickNumber(doc.Height, doc.height);
    const areaSqm =
      widthMm && heightMm ? Number(((widthMm * heightMm) / 1_000_000).toFixed(4)) : null;

    const searchText = [sourcePath, sourceFileName, documentName].filter(Boolean).join(" ");
    const jobRefs = extractJobReferencesFromText(searchText);
    const itemRef = extractItemReferenceFromText(searchText);

    const row = {
      printfactory_job_id: printfactoryJobId,
      document_guid: documentGuid,
      document_name: documentName,
      source_file_path: sourcePath,
      source_file_name: sourceFileName,
      width_mm: widthMm,
      height_mm: heightMm,
      area_sqm: areaSqm,
      raw_metadata: doc as Record<string, unknown>,
      extracted_job_reference: jobRefs[0] ?? null,
      extracted_item_reference: itemRef,
      updated_at: new Date().toISOString(),
    };

    if (documentGuid) {
      const { error } = await adminClient
        .from("printfactory_job_documents")
        .upsert(row, { onConflict: "printfactory_job_id,document_guid" });

      if (error) {
        if (error.code === "42P01") {
          return { upserted: 0, schemaMissing: true as const };
        }

        throw error;
      }
    } else {
      const { error } = await adminClient.from("printfactory_job_documents").insert(row);

      if (error) {
        if (error.code === "42P01") {
          return { upserted: 0, schemaMissing: true as const };
        }

        throw error;
      }
    }

    upserted += 1;
  }

  return { upserted };
}
