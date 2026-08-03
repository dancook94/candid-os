import type { SupabaseClient } from "@supabase/supabase-js";

export type PrintfactorySchemaReadiness = {
  ready: boolean;
  missingObject: string | null;
  message: string | null;
};

const REQUIRED_PRINTFACTORY_JOBS_COLUMNS = [
  "raw_metadata",
  "job_match_status",
  "job_match_method",
  "job_match_confidence",
  "extracted_job_reference",
  "candid_job_id",
  "source_file_path",
  "source_file_name",
] as const;

function normalizeRelationName(relation: string) {
  return relation.includes(".") ? relation : `public.${relation}`;
}

function formatMissingMessage(object: string): string {
  return `PrintFactory matching unavailable: ${object} is missing.`;
}

function parseMissingRelation(error: { code?: string; message?: string }) {
  if (error.code !== "42P01") {
    return null;
  }

  const message = error.message ?? "";
  const match =
    message.match(/relation "([^"]+)" does not exist/i) ??
    message.match(/table "([^"]+)" does not exist/i);

  if (!match) {
    return null;
  }

  return normalizeRelationName(match[1]);
}

function parseMissingColumn(error: { code?: string; message?: string }) {
  if (error.code !== "42703") {
    return null;
  }

  const message = error.message ?? "";
  const match = message.match(/column ([\w.]+) does not exist/i);

  if (!match) {
    return null;
  }

  const columnRef = match[1];

  if (columnRef.includes(".")) {
    const [table, column] = columnRef.split(".");
    return `${normalizeRelationName(table)}.${column}`;
  }

  return `public.printfactory_jobs.${columnRef}`;
}

export function printfactorySchemaErrorToReadiness(error: {
  code?: string;
  message?: string;
}): PrintfactorySchemaReadiness | null {
  const missingObject =
    parseMissingColumn(error) ?? parseMissingRelation(error);

  if (!missingObject) {
    return null;
  }

  return {
    ready: false,
    missingObject,
    message: formatMissingMessage(missingObject),
  };
}

async function probeTable(
  adminClient: SupabaseClient,
  tableName: string
): Promise<PrintfactorySchemaReadiness | null> {
  const { error } = await adminClient.from(tableName).select("id").limit(0);

  if (!error) {
    return null;
  }

  const missingObject =
    parseMissingRelation(error) ?? `public.${tableName}`;

  return {
    ready: false,
    missingObject,
    message: formatMissingMessage(missingObject),
  };
}

async function probePrintfactoryJobsColumns(adminClient: SupabaseClient) {
  const columnList = REQUIRED_PRINTFACTORY_JOBS_COLUMNS.join(", ");
  const { error: combinedError } = await adminClient
    .from("printfactory_jobs")
    .select(columnList)
    .limit(0);

  if (!combinedError) {
    return null;
  }

  if (combinedError.code === "42703") {
    for (const column of REQUIRED_PRINTFACTORY_JOBS_COLUMNS) {
      const { error } = await adminClient
        .from("printfactory_jobs")
        .select(column)
        .limit(0);

      if (error) {
        const missingObject =
          parseMissingColumn(error) ?? `public.printfactory_jobs.${column}`;

        return {
          ready: false as const,
          missingObject,
          message: formatMissingMessage(missingObject),
        };
      }
    }
  }

  const missingObject =
    parseMissingColumn(combinedError) ??
    parseMissingRelation(combinedError) ??
    "public.printfactory_jobs";

  return {
    ready: false as const,
    missingObject,
    message: formatMissingMessage(missingObject),
  };
}

/**
 * Inspects live public schema objects required for PrintFactory matching.
 * Does not rely on migration history tables.
 */
export async function checkPrintfactorySchemaReadiness(
  adminClient: SupabaseClient
): Promise<PrintfactorySchemaReadiness> {
  const jobsTable = await probeTable(adminClient, "printfactory_jobs");

  if (jobsTable) {
    return jobsTable;
  }

  const jobsColumns = await probePrintfactoryJobsColumns(adminClient);

  if (jobsColumns) {
    return jobsColumns;
  }

  const linkTable = await probeTable(adminClient, "printfactory_job_manifest_items");

  if (linkTable) {
    return linkTable;
  }

  const mappingRulesTable = await probeTable(
    adminClient,
    "printfactory_mapping_rules"
  );

  if (mappingRulesTable) {
    return mappingRulesTable;
  }

  return {
    ready: true,
    missingObject: null,
    message: null,
  };
}

export { REQUIRED_PRINTFACTORY_JOBS_COLUMNS };
