import { PrintfactoryError } from "@/lib/printfactory/errors";

import type { SyncStageName } from "@/lib/printfactory/sync-timing";

export type NormalizedSyncError = {
  errorName: string;
  safeMessage: string;
  errorCode: string;
  httpStatus: number | null;
  printfactoryResponseStatus: number | null;
  postgrestCode: string | null;
  postgrestDetails: string | null;
  postgrestHint: string | null;
};

const SECRET_PATTERNS: RegExp[] = [
  /\bMisKey\b/i,
  /service[-_ ]?role/i,
  /SUPABASE_SERVICE_ROLE/i,
  /RESEND_API/i,
  /Authorization:\s*\S+/i,
  /\bBearer\s+[A-Za-z0-9._-]+\b/i,
  /PRINTFACTORY_API_(TOKEN|KEY)/i,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
];

export function redactSyncSecrets(value: string): string {
  let result = value;

  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[redacted]");
  }

  return result;
}

function serializeSafeField(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return redactSyncSecrets(value);
  }

  try {
    return redactSyncSecrets(JSON.stringify(value));
  } catch {
    return redactSyncSecrets(String(value));
  }
}

function readObjectString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readObjectNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeSyncError(error: unknown): NormalizedSyncError {
  if (error instanceof PrintfactoryError) {
    return {
      errorName: error.name,
      safeMessage: redactSyncSecrets(error.message),
      errorCode: error.code,
      httpStatus: error.status,
      printfactoryResponseStatus: error.status,
      postgrestCode: null,
      postgrestDetails: null,
      postgrestHint: null,
    };
  }

  if (error instanceof Error) {
    return {
      errorName: error.name,
      safeMessage: redactSyncSecrets(error.message),
      errorCode: "sync_failed",
      httpStatus: null,
      printfactoryResponseStatus: null,
      postgrestCode: null,
      postgrestDetails: null,
      postgrestHint: null,
    };
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = readObjectString(record, "message");
    const code = readObjectString(record, "code");
    const httpStatus = readObjectNumber(record, "status");

    return {
      errorName: readObjectString(record, "name") ?? "PostgrestError",
      safeMessage: message
        ? redactSyncSecrets(message)
        : "PrintFactory sync failed.",
      errorCode: "sync_failed",
      httpStatus,
      printfactoryResponseStatus: httpStatus,
      postgrestCode: code,
      postgrestDetails: serializeSafeField(record.details),
      postgrestHint: readObjectString(record, "hint")
        ? redactSyncSecrets(readObjectString(record, "hint")!)
        : null,
    };
  }

  return {
    errorName: "UnknownError",
    safeMessage: "PrintFactory sync failed.",
    errorCode: "sync_failed",
    httpStatus: null,
    printfactoryResponseStatus: null,
    postgrestCode: null,
    postgrestDetails: null,
    postgrestHint: null,
  };
}

export type SyncFailureLogContext = {
  failingStage: SyncStageName | null;
  error: unknown;
  recordsReceived: number;
  imported: number;
  updated: number;
  syncWindowDateTimeFrom?: string | null;
  syncWindowDateTimeTo?: string | null;
  printfactoryResponseStatus?: number | null;
};

export function buildSyncFailureLogPayload(context: SyncFailureLogContext) {
  const normalized = normalizeSyncError(context.error);

  return {
    failingStage: context.failingStage,
    errorName: normalized.errorName,
    safeMessage: normalized.safeMessage,
    errorCode: normalized.errorCode,
    httpStatus: normalized.httpStatus,
    printfactoryResponseStatus:
      context.printfactoryResponseStatus ?? normalized.printfactoryResponseStatus,
    postgrestCode: normalized.postgrestCode,
    postgrestDetails: normalized.postgrestDetails,
    postgrestHint: normalized.postgrestHint,
    recordsReceived: context.recordsReceived,
    imported: context.imported,
    updated: context.updated,
    recordsUpserted: context.imported + context.updated,
    syncWindowDateTimeFrom: context.syncWindowDateTimeFrom ?? null,
    syncWindowDateTimeTo: context.syncWindowDateTimeTo ?? null,
  };
}

/** Production-safe sync failure logging (no secrets). */
export function logSyncFailure(context: SyncFailureLogContext) {
  console.error(
    "[printfactory sync failure]",
    JSON.stringify(buildSyncFailureLogPayload(context))
  );
}
