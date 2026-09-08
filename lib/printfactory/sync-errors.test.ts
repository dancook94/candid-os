import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PrintfactoryError } from "@/lib/printfactory/errors";
import {
  buildSyncFailureLogPayload,
  normalizeSyncError,
  redactSyncSecrets,
} from "@/lib/printfactory/sync-errors";
import { buildPrintfactorySyncStateRow } from "@/lib/printfactory/sync-state-patch";

describe("normalizeSyncError", () => {
  it("extracts message from Error instances", () => {
    const normalized = normalizeSyncError(new Error("Database connection lost."));

    assert.equal(normalized.errorName, "Error");
    assert.equal(normalized.safeMessage, "Database connection lost.");
    assert.equal(normalized.errorCode, "sync_failed");
  });

  it("extracts message from plain Supabase/PostgREST error objects", () => {
    const normalized = normalizeSyncError({
      message: "insert or update on table violates foreign key constraint",
      code: "23503",
      details: "Key (candid_job_id)=(...) is not present in table jobs.",
      hint: "Check the referenced row exists.",
    });

    assert.equal(normalized.errorName, "PostgrestError");
    assert.match(
      normalized.safeMessage,
      /violates foreign key constraint/
    );
    assert.equal(normalized.postgrestCode, "23503");
    assert.match(normalized.postgrestDetails ?? "", /candid_job_id/);
    assert.equal(normalized.postgrestHint, "Check the referenced row exists.");
  });

  it("maps PrintFactory HTTP errors with status", () => {
    const normalized = normalizeSyncError(
      new PrintfactoryError(
        "PrintFactory API authentication failed. Check PRINTFACTORY_API_TOKEN.",
        "auth_failed",
        401
      )
    );

    assert.equal(normalized.errorCode, "auth_failed");
    assert.equal(normalized.httpStatus, 401);
    assert.equal(normalized.printfactoryResponseStatus, 401);
    assert.match(normalized.safeMessage, /authentication failed/i);
  });
});

describe("buildSyncFailureLogPayload", () => {
  it("includes failingStage and progress counters", () => {
    const payload = buildSyncFailureLogPayload({
      failingStage: "database_upsert",
      error: { message: "invalid input syntax for type timestamp with time zone" },
      recordsReceived: 12,
      imported: 4,
      updated: 3,
      syncWindowDateTimeFrom: "2026-09-03T00:00:00.000Z",
      syncWindowDateTimeTo: "2026-09-08T15:06:06.351Z",
      printfactoryResponseStatus: null,
    });

    assert.equal(payload.failingStage, "database_upsert");
    assert.equal(payload.recordsReceived, 12);
    assert.equal(payload.imported, 4);
    assert.equal(payload.updated, 3);
    assert.equal(payload.recordsUpserted, 7);
    assert.equal(payload.syncWindowDateTimeFrom, "2026-09-03T00:00:00.000Z");
    assert.match(payload.safeMessage, /invalid input syntax/i);
  });

  it("does not include secrets in logged output", () => {
    const payload = buildSyncFailureLogPayload({
      failingStage: "api_request",
      error: new Error(
        "Request failed Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig MisKey=secret-token"
      ),
      recordsReceived: 0,
      imported: 0,
      updated: 0,
    });

    const serialized = JSON.stringify(payload);

    assert.doesNotMatch(serialized, /Bearer eyJ/);
    assert.doesNotMatch(serialized, /MisKey=secret-token/);
    assert.match(serialized, /\[redacted\]/);
  });
});

describe("redactSyncSecrets", () => {
  it("redacts known secret markers from messages", () => {
    const redacted = redactSyncSecrets(
      "Missing SUPABASE_SERVICE_ROLE_KEY or PRINTFACTORY_API_TOKEN MisKey value"
    );

    assert.doesNotMatch(redacted, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(redacted, /PRINTFACTORY_API_TOKEN/);
    assert.doesNotMatch(redacted, /\bMisKey\b/);
  });
});

describe("buildPrintfactorySyncStateRow", () => {
  it("does not include last_successful_sync_at when omitted from the patch", () => {
    const row = buildPrintfactorySyncStateRow({
      lastAttemptedSyncAt: "2026-09-08T15:06:06.351Z",
      lastError: "insert or update on table violates foreign key constraint",
      lastRecordCount: 12,
    });

    assert.equal("last_successful_sync_at" in row, false);
    assert.equal(row.last_attempted_sync_at, "2026-09-08T15:06:06.351Z");
    assert.equal(row.last_error, "insert or update on table violates foreign key constraint");
    assert.equal(row.last_record_count, 12);
  });

  it("updates last_successful_sync_at only when explicitly provided", () => {
    const row = buildPrintfactorySyncStateRow({
      lastSuccessfulSyncAt: "2026-09-03T14:14:25.719Z",
      lastAttemptedSyncAt: "2026-09-08T15:06:06.351Z",
      lastError: null,
    });

    assert.equal(row.last_successful_sync_at, "2026-09-03T14:14:25.719Z");
  });
});

describe("sync failure API shape", () => {
  it("provides safeMessage and failingStage fields for clients", () => {
    const normalized = normalizeSyncError({
      message: "permission denied for table printfactory_jobs",
      code: "42501",
    });

    const apiBody = {
      ok: false,
      error: normalized.safeMessage,
      safeMessage: normalized.safeMessage,
      failingStage: "parent_job_matching",
      errorCode: normalized.errorCode,
      recordsReceived: 0,
      imported: 0,
    };

    assert.equal(apiBody.ok, false);
    assert.equal(apiBody.safeMessage, apiBody.error);
    assert.equal(apiBody.failingStage, "parent_job_matching");
    assert.match(apiBody.safeMessage, /permission denied/i);
  });
});
