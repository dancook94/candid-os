import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildPrintfactorySyncStateRow,
  type PrintfactorySyncStatePatch,
} from "@/lib/printfactory/sync-state-patch";

export type SyncLockMode = "live";

export type PrintfactorySyncState = {
  /** @deprecated Legacy audit only — not used for live sync window. */
  lastSuccessfulSyncAt: string | null;
  /** @deprecated Legacy audit only. */
  lastAttemptedSyncAt: string | null;
  /** @deprecated Legacy audit only — not used for live sync pagination. */
  lastSkipCursor: number;
  /** @deprecated Legacy audit only. */
  lastRecordCount: number | null;
  /** @deprecated Legacy audit only. */
  lastError: string | null;

  liveLastSuccessfulAt: string | null;
  liveLastAttemptedAt: string | null;
  liveLastError: string | null;
  liveWindowCapped: boolean;

  syncLockedUntil: string | null;
  syncLockMode: SyncLockMode | null;

  /** True when new live sync columns exist in the database. */
  schemaExtended: boolean;
};

const SINGLETON_KEY = "default";

const EXTENDED_SELECT =
  "last_successful_sync_at, last_attempted_sync_at, last_skip_cursor, last_record_count, last_error, live_last_successful_at, live_last_attempted_at, live_last_error, live_window_capped, sync_locked_until, sync_lock_mode";

const LEGACY_SELECT =
  "last_successful_sync_at, last_attempted_sync_at, last_skip_cursor, last_record_count, last_error";

function mapRow(data: Record<string, unknown>, schemaExtended: boolean): PrintfactorySyncState {
  const lastSuccessfulSyncAt = (data.last_successful_sync_at as string | null) ?? null;
  const lastAttemptedSyncAt = (data.last_attempted_sync_at as string | null) ?? null;
  const lastSkipCursor = (data.last_skip_cursor as number | null) ?? 0;
  const lastError = (data.last_error as string | null) ?? null;

  return {
    lastSuccessfulSyncAt,
    lastAttemptedSyncAt,
    lastSkipCursor,
    lastRecordCount: (data.last_record_count as number | null) ?? null,
    lastError,
    liveLastSuccessfulAt: schemaExtended
      ? ((data.live_last_successful_at as string | null) ?? null)
      : null,
    liveLastAttemptedAt: schemaExtended
      ? ((data.live_last_attempted_at as string | null) ?? lastAttemptedSyncAt)
      : lastAttemptedSyncAt,
    liveLastError: schemaExtended
      ? ((data.live_last_error as string | null) ?? lastError)
      : lastError,
    liveWindowCapped: schemaExtended ? Boolean(data.live_window_capped) : false,
    syncLockedUntil: schemaExtended
      ? ((data.sync_locked_until as string | null) ?? null)
      : null,
    syncLockMode: schemaExtended
      ? ((data.sync_lock_mode as SyncLockMode | null) ?? null)
      : null,
    schemaExtended,
  };
}

function emptySyncState(): PrintfactorySyncState {
  return mapRow({}, false);
}

export async function loadPrintfactorySyncState(
  adminClient: SupabaseClient
): Promise<PrintfactorySyncState> {
  const extended = await adminClient
    .from("printfactory_sync_state")
    .select(EXTENDED_SELECT)
    .eq("singleton_key", SINGLETON_KEY)
    .maybeSingle();

  if (!extended.error && extended.data) {
    return mapRow(extended.data as Record<string, unknown>, true);
  }

  if (extended.error?.code === "42703") {
    const legacy = await adminClient
      .from("printfactory_sync_state")
      .select(LEGACY_SELECT)
      .eq("singleton_key", SINGLETON_KEY)
      .maybeSingle();

    if (legacy.error) {
      if (legacy.error.code === "42P01") {
        return emptySyncState();
      }

      throw legacy.error;
    }

    if (!legacy.data) {
      return emptySyncState();
    }

    return mapRow(legacy.data as Record<string, unknown>, false);
  }

  if (extended.error) {
    if (extended.error.code === "42P01") {
      return emptySyncState();
    }

    throw extended.error;
  }

  if (!extended.data) {
    return emptySyncState();
  }

  return mapRow(extended.data as Record<string, unknown>, true);
}

export async function savePrintfactorySyncState(
  adminClient: SupabaseClient,
  update: PrintfactorySyncStatePatch
) {
  const row = buildPrintfactorySyncStateRow(update);

  const { error } = await adminClient
    .from("printfactory_sync_state")
    .upsert(row, { onConflict: "singleton_key" });

  if (error && error.code !== "42P01" && error.code !== "42703") {
    throw error;
  }
}
