import type { SupabaseClient } from "@supabase/supabase-js";

import schemaRequirements from "./schema-requirements.json" with { type: "json" };

export const PRINTFACTORY_REQUIRED_TABLES =
  schemaRequirements.tables as readonly string[];

export const PRINTFACTORY_REQUIRED_JOBS_COLUMNS =
  schemaRequirements.jobsColumns as readonly string[];

export type PrintfactorySchemaQueryError = {
  object: string;
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
};

export type PrintfactorySchemaReadiness = {
  ready: boolean;
  missingObject: string | null;
  message: string | null;
  missingTables: string[];
  missingColumns: string[];
  queryErrors: PrintfactorySchemaQueryError[];
};

export type PrintfactoryDataQueryError = {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
};

function normalizeRelationName(relation: string) {
  return relation.includes(".") ? relation : `public.${relation}`;
}

function formatMissingMessage(object: string): string {
  return `PrintFactory matching unavailable: ${object} is missing.`;
}

function toQueryError(
  object: string,
  error: { code?: string; message?: string; details?: string; hint?: string }
): PrintfactorySchemaQueryError {
  return {
    object,
    code: error.code ?? null,
    message: error.message ?? "Unknown error.",
    details: error.details ?? null,
    hint: error.hint ?? null,
  };
}

export function toPrintfactoryDataQueryError(error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}): PrintfactoryDataQueryError {
  return {
    code: error.code ?? null,
    message: error.message ?? "Unknown query error.",
    details: error.details ?? null,
    hint: error.hint ?? null,
  };
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

function parseMissingColumn(error: {
  code?: string;
  message?: string;
}): { table: string; column: string } | null {
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
    return {
      table: normalizeRelationName(table),
      column,
    };
  }

  return {
    table: "public.printfactory_jobs",
    column: columnRef,
  };
}

function logSchemaReadinessDev(result: PrintfactorySchemaReadiness) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.error("[printfactory schema readiness]", {
    ready: result.ready,
    missingTables: result.missingTables,
    missingColumns: result.missingColumns,
    queryErrors: result.queryErrors,
  });
}

function logMatchingDataQueryDev(error: PrintfactoryDataQueryError) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.error("[printfactory matching data query]", error);
}

export { logMatchingDataQueryDev };

/**
 * Inspects live public schema objects required for PrintFactory matching.
 * Does not rely on migration history tables.
 *
 * Only PostgreSQL 42P01 (missing relation) and 42703 (missing column) on
 * required objects are treated as schema-not-ready. Other probe errors are
 * recorded separately and do not flip readiness.
 */
export async function checkPrintfactorySchemaReadiness(
  adminClient: SupabaseClient
): Promise<PrintfactorySchemaReadiness> {
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  const queryErrors: PrintfactorySchemaQueryError[] = [];

  for (const tableName of PRINTFACTORY_REQUIRED_TABLES) {
    const objectName = `public.${tableName}`;
    const { error } = await adminClient.from(tableName).select("id").limit(0);

    if (!error) {
      continue;
    }

    const missingRelation = parseMissingRelation(error);

    if (missingRelation) {
      missingTables.push(missingRelation);
      continue;
    }

    queryErrors.push(toQueryError(objectName, error));
  }

  const columnList = PRINTFACTORY_REQUIRED_JOBS_COLUMNS.join(", ");
  const { error: combinedColumnError } = await adminClient
    .from("printfactory_jobs")
    .select(columnList)
    .limit(0);

  if (combinedColumnError) {
    const missingColumn = parseMissingColumn(combinedColumnError);

    if (missingColumn) {
      const objectName = `${missingColumn.table}.${missingColumn.column}`;

      if (!missingColumns.includes(objectName)) {
        missingColumns.push(objectName);
      }
    } else if (combinedColumnError.code === "42703") {
      for (const column of PRINTFACTORY_REQUIRED_JOBS_COLUMNS) {
        const { error } = await adminClient
          .from("printfactory_jobs")
          .select(column)
          .limit(0);

        if (!error) {
          continue;
        }

        const parsed = parseMissingColumn(error);

        if (parsed) {
          const objectName = `${parsed.table}.${parsed.column}`;

          if (!missingColumns.includes(objectName)) {
            missingColumns.push(objectName);
          }
        } else {
          queryErrors.push(
            toQueryError(`public.printfactory_jobs.${column}`, error)
          );
        }
      }
    } else {
      queryErrors.push(
        toQueryError("public.printfactory_jobs", combinedColumnError)
      );
    }
  }

  const ready = missingTables.length === 0 && missingColumns.length === 0;
  const missingObject = missingTables[0] ?? missingColumns[0] ?? null;
  const message = missingObject ? formatMissingMessage(missingObject) : null;

  const result: PrintfactorySchemaReadiness = {
    ready,
    missingObject,
    message,
    missingTables,
    missingColumns,
    queryErrors,
  };

  logSchemaReadinessDev(result);

  return result;
}
