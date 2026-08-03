import type { SupabaseClient } from "@supabase/supabase-js";

export type PrintfactorySyncState = {
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
  lastSkipCursor: number;
  lastRecordCount: number | null;
  lastError: string | null;
};

const SINGLETON_KEY = "default";

export async function loadPrintfactorySyncState(
  adminClient: SupabaseClient
): Promise<PrintfactorySyncState> {
  const { data, error } = await adminClient
    .from("printfactory_sync_state")
    .select(
      "last_successful_sync_at, last_attempted_sync_at, last_skip_cursor, last_record_count, last_error"
    )
    .eq("singleton_key", SINGLETON_KEY)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      return emptySyncState();
    }

    throw error;
  }

  if (!data) {
    return emptySyncState();
  }

  return {
    lastSuccessfulSyncAt: (data.last_successful_sync_at as string | null) ?? null,
    lastAttemptedSyncAt: (data.last_attempted_sync_at as string | null) ?? null,
    lastSkipCursor: (data.last_skip_cursor as number | null) ?? 0,
    lastRecordCount: (data.last_record_count as number | null) ?? null,
    lastError: (data.last_error as string | null) ?? null,
  };
}

function emptySyncState(): PrintfactorySyncState {
  return {
    lastSuccessfulSyncAt: null,
    lastAttemptedSyncAt: null,
    lastSkipCursor: 0,
    lastRecordCount: null,
    lastError: null,
  };
}

export async function savePrintfactorySyncState(
  adminClient: SupabaseClient,
  update: Partial<PrintfactorySyncState> & { lastError?: string | null }
) {
  const now = new Date().toISOString();
  const row = {
    singleton_key: SINGLETON_KEY,
    last_successful_sync_at: update.lastSuccessfulSyncAt,
    last_attempted_sync_at: update.lastAttemptedSyncAt ?? now,
    last_skip_cursor: update.lastSkipCursor ?? 0,
    last_record_count: update.lastRecordCount ?? null,
    last_error: update.lastError ?? null,
    updated_at: now,
  };

  const { error } = await adminClient
    .from("printfactory_sync_state")
    .upsert(row, { onConflict: "singleton_key" });

  if (error && error.code !== "42P01") {
    throw error;
  }
}
