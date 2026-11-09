import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildSicknessCalendarEvent,
  buildTeamLeaveCalendarEvent,
} from "@/lib/staff-leave/calendar-sync/build-event";
import {
  claimCalendarOutboxBatch,
  hasFreshCalendarOutboxSiblingProcessing,
} from "@/lib/staff-leave/calendar-sync/concurrency";
import { getStaffLeaveCalendarDeliveryGate } from "@/lib/staff-leave/calendar-sync/delivery-gate";
import { mappingNeedsGoogleResync } from "@/lib/staff-leave/calendar-sync/mapping-transition";
import {
  isStaffLeaveCalendarChannel,
  isStaffLeaveCalendarOperation,
} from "@/lib/staff-leave/calendar-sync/kinds";
import { sortCalendarSyncOutboxRows } from "@/lib/staff-leave/calendar-sync/outbox-order";
import {
  STAFF_LEAVE_CALENDAR_OUTBOX_DEFAULT_BATCH_LIMIT,
  STAFF_LEAVE_CALENDAR_OUTBOX_MAX_ATTEMPTS,
  STAFF_LEAVE_CALENDAR_OUTBOX_STALE_LOCK_MS,
} from "@/lib/staff-leave/calendar-sync/outbox-constants";
import { createStaffLeaveCalendarSyncProvider } from "@/lib/staff-leave/calendar-sync/provider";
import {
  validateLeaveCalendarOperation,
  validateSicknessCalendarOperation,
} from "@/lib/staff-leave/calendar-sync/source-state";

type CalendarOutboxRow = {
  id: string;
  calendar_channel: string;
  operation: string;
  source_kind: string;
  leave_request_id: string | null;
  sickness_id: string | null;
  employee_profile_id: string | null;
  status: string;
  attempts: number;
  locked_at?: string | null;
  created_at: string;
};

export type ProcessStaffLeaveCalendarOutboxResult = {
  processed: number;
  sent: number;
  failed: number;
  discarded: number;
  skipped: number;
  mockDelivered: number;
  errors: string[];
};

export { STAFF_LEAVE_CALENDAR_OUTBOX_MAX_ATTEMPTS, STAFF_LEAVE_CALENDAR_OUTBOX_STALE_LOCK_MS };

export function staleStaffLeaveCalendarOutboxLockCutoff(nowMs = Date.now()) {
  return new Date(nowMs - STAFF_LEAVE_CALENDAR_OUTBOX_STALE_LOCK_MS).toISOString();
}

export function isStaleStaffLeaveCalendarOutboxLock(
  lockedAt: string | null | undefined,
  nowMs = Date.now()
) {
  if (!lockedAt) {
    return true;
  }

  const lockedMs = Date.parse(lockedAt);

  if (!Number.isFinite(lockedMs)) {
    return true;
  }

  return nowMs - lockedMs >= STAFF_LEAVE_CALENDAR_OUTBOX_STALE_LOCK_MS;
}

export function buildStaffLeaveCalendarOutboxClaimFilter(staleCutoffIso: string) {
  return [
    "status.in.(pending,failed)",
    `and(status.eq.processing,locked_at.lt.${staleCutoffIso})`,
    "and(status.eq.processing,locked_at.is.null)",
  ].join(",");
}

export async function processStaffLeaveCalendarSyncOutbox(
  adminClient: SupabaseClient,
  input?: { outboxId?: string; limit?: number }
): Promise<ProcessStaffLeaveCalendarOutboxResult> {
  const limit =
    input?.outboxId != null && input.outboxId !== ""
      ? 1
      : input?.limit ?? STAFF_LEAVE_CALENDAR_OUTBOX_DEFAULT_BATCH_LIMIT;
  const staleCutoff = staleStaffLeaveCalendarOutboxLockCutoff();
  const claimFilter = buildStaffLeaveCalendarOutboxClaimFilter(staleCutoff);
  const deliveryGate = getStaffLeaveCalendarDeliveryGate();

  const result: ProcessStaffLeaveCalendarOutboxResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    discarded: 0,
    skipped: 0,
    mockDelivered: 0,
    errors: [],
  };

  const orderedRows = await loadClaimedCalendarOutboxRows(adminClient, {
    outboxId: input?.outboxId,
    limit,
    staleCutoff,
    claimFilter,
    result,
  });

  if (result.errors.includes("staff_leave_calendar_sync_outbox_missing")) {
    return result;
  }

  if (!deliveryGate.allowed) {
    for (const row of orderedRows) {
      result.processed += 1;

      try {
        await markCalendarOutboxFailed(adminClient, row, deliveryGate.reason);
        result.failed += 1;
        result.errors.push(deliveryGate.reason);
      } catch (markError) {
        result.errors.push(toErrorMessage(markError));
      }
    }

    return result;
  }

  const provider = createStaffLeaveCalendarSyncProvider(deliveryGate.provider);

  for (const row of orderedRows) {
    result.processed += 1;

    try {
      const delivery = await deliverCalendarOutboxRow(adminClient, row, deliveryGate, provider);

      if (delivery.outcome === "sent") {
        await markCalendarOutboxSent(adminClient, row.id, delivery.syncProvider);
        result.sent += 1;
        if (delivery.mockDelivery) {
          result.mockDelivered += 1;
        }
      } else if (delivery.outcome === "discarded") {
        await markCalendarOutboxDiscarded(adminClient, row.id, delivery.reason);
        result.discarded += 1;
      } else {
        await markCalendarOutboxFailed(adminClient, row, delivery.errorMessage);
        result.failed += 1;
        if (delivery.errorMessage) {
          result.errors.push(delivery.errorMessage);
        }
      }
    } catch (error) {
      const message = toErrorMessage(error);

      try {
        await markCalendarOutboxFailed(adminClient, row, message);
      } catch (markError) {
        result.errors.push(toErrorMessage(markError));
      }

      result.failed += 1;
      result.errors.push(message);
    }
  }

  return result;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadClaimedCalendarOutboxRows(
  adminClient: SupabaseClient,
  input: {
    outboxId?: string;
    limit: number;
    staleCutoff: string;
    claimFilter: string;
    result: ProcessStaffLeaveCalendarOutboxResult;
  }
): Promise<CalendarOutboxRow[]> {
  const selectFields =
    "id, calendar_channel, operation, source_kind, leave_request_id, sickness_id, employee_profile_id, status, attempts, locked_at, created_at";

  if (input.outboxId) {
    const { data, error } = await adminClient
      .from("staff_leave_calendar_sync_outbox")
      .select(selectFields)
      .eq("id", input.outboxId)
      .maybeSingle();

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        input.result.skipped += 1;
        input.result.errors.push("staff_leave_calendar_sync_outbox_missing");
        return [];
      }

      throw error;
    }

    if (!data) {
      return [];
    }

    const claimed = await claimCalendarOutboxRow(
      adminClient,
      data as CalendarOutboxRow,
      input.claimFilter,
      input.staleCutoff
    );

    return claimed ? [data as CalendarOutboxRow] : [];
  }

  const batchClaimed = await claimCalendarOutboxBatch(adminClient, {
    limit: input.limit,
    staleBeforeIso: input.staleCutoff,
  });

  if (batchClaimed && batchClaimed.length > 0) {
    const { data, error } = await adminClient
      .from("staff_leave_calendar_sync_outbox")
      .select(selectFields)
      .in("id", batchClaimed);

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        input.result.skipped += 1;
        input.result.errors.push("staff_leave_calendar_sync_outbox_missing");
        return [];
      }

      throw error;
    }

    return sortCalendarSyncOutboxRows((data ?? []) as CalendarOutboxRow[]);
  }

  let query = adminClient
    .from("staff_leave_calendar_sync_outbox")
    .select(selectFields)
    .or(input.claimFilter)
    .lt("attempts", STAFF_LEAVE_CALENDAR_OUTBOX_MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(input.limit);

  const { data: pendingRows, error: fetchError } = await query;

  if (fetchError) {
    if (fetchError.code === "42P01" || fetchError.code === "PGRST205") {
      input.result.skipped += 1;
      input.result.errors.push("staff_leave_calendar_sync_outbox_missing");
      return [];
    }

    throw fetchError;
  }

  const orderedCandidates = sortCalendarSyncOutboxRows((pendingRows ?? []) as CalendarOutboxRow[]);
  const claimedRows: CalendarOutboxRow[] = [];

  for (const row of orderedCandidates) {
    if (claimedRows.length >= input.limit) {
      break;
    }

    const blocked = await hasFreshCalendarOutboxSiblingProcessing(
      adminClient,
      row,
      input.staleCutoff
    );

    if (blocked) {
      input.result.skipped += 1;
      continue;
    }

    const claimed = await claimCalendarOutboxRow(
      adminClient,
      row,
      input.claimFilter,
      input.staleCutoff
    );

    if (claimed) {
      claimedRows.push(row);
    } else {
      input.result.skipped += 1;
    }
  }

  return sortCalendarSyncOutboxRows(claimedRows);
}

async function claimCalendarOutboxRow(
  adminClient: SupabaseClient,
  row: CalendarOutboxRow,
  claimFilter: string,
  staleCutoff: string
) {
  const blocked = await hasFreshCalendarOutboxSiblingProcessing(adminClient, row, staleCutoff);

  if (blocked) {
    return false;
  }

  const now = new Date().toISOString();

  const { data, error } = await adminClient
    .from("staff_leave_calendar_sync_outbox")
    .update({ status: "processing", locked_at: now })
    .eq("id", row.id)
    .or(claimFilter)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data?.id);
}

async function markCalendarOutboxSent(
  adminClient: SupabaseClient,
  outboxId: string,
  syncProvider: "mock" | "google"
) {
  const now = new Date().toISOString();

  const { error } = await adminClient
    .from("staff_leave_calendar_sync_outbox")
    .update({
      status: "sent",
      sync_provider: syncProvider,
      processed_at: now,
      last_error: null,
    })
    .eq("id", outboxId);

  if (error) {
    throw error;
  }
}

async function markCalendarOutboxDiscarded(
  adminClient: SupabaseClient,
  outboxId: string,
  reason: string
) {
  const now = new Date().toISOString();

  const { error } = await adminClient
    .from("staff_leave_calendar_sync_outbox")
    .update({
      status: "discarded",
      discarded_at: now,
      discard_reason: reason,
      processed_at: now,
      last_error: null,
      locked_at: null,
    })
    .eq("id", outboxId);

  if (error) {
    throw error;
  }
}

async function markCalendarOutboxFailed(
  adminClient: SupabaseClient,
  row: CalendarOutboxRow,
  errorMessage: string | null
) {
  const now = new Date().toISOString();

  const { error } = await adminClient
    .from("staff_leave_calendar_sync_outbox")
    .update({
      status: "failed",
      attempts: row.attempts + 1,
      last_error: errorMessage,
      processed_at: now,
      locked_at: null,
    })
    .eq("id", row.id);

  if (error) {
    throw error;
  }
}

type ActiveDeliveryGate = Extract<
  ReturnType<typeof getStaffLeaveCalendarDeliveryGate>,
  { allowed: true }
>;

type DeliveryOutcome =
  | { outcome: "sent"; syncProvider: "mock" | "google"; mockDelivery: boolean }
  | { outcome: "discarded"; reason: string }
  | { outcome: "failed"; errorMessage: string };

async function deliverCalendarOutboxRow(
  adminClient: SupabaseClient,
  row: CalendarOutboxRow,
  gate: ActiveDeliveryGate,
  provider: ReturnType<typeof createStaffLeaveCalendarSyncProvider>
): Promise<DeliveryOutcome> {
  if (
    !isStaffLeaveCalendarChannel(row.calendar_channel) ||
    !isStaffLeaveCalendarOperation(row.operation)
  ) {
    return { outcome: "failed", errorMessage: "invalid_calendar_outbox_row" };
  }

  if (row.leave_request_id) {
    return deliverLeaveCalendarOutboxRow(adminClient, row, gate, provider);
  }

  if (row.sickness_id) {
    return deliverSicknessCalendarOutboxRow(adminClient, row, gate, provider);
  }

  return { outcome: "failed", errorMessage: "missing_outbox_source" };
}

async function deliverLeaveCalendarOutboxRow(
  adminClient: SupabaseClient,
  row: CalendarOutboxRow,
  gate: ActiveDeliveryGate,
  provider: ReturnType<typeof createStaffLeaveCalendarSyncProvider>
): Promise<DeliveryOutcome> {
  if (!isStaffLeaveCalendarOperation(row.operation)) {
    return { outcome: "failed", errorMessage: "invalid_calendar_operation" };
  }

  const operation = row.operation;

  const { data: request, error } = await adminClient
    .from("staff_leave_requests")
    .select("id, status, leave_kind, start_date, end_date, day_portion, profile_id")
    .eq("id", row.leave_request_id)
    .maybeSingle();

  if (error) {
    if (error.code === "42501") {
      return { outcome: "failed", errorMessage: "staff_leave_requests_select_denied" };
    }

    throw error;
  }

  if (!request) {
    return { outcome: "failed", errorMessage: "missing_leave_request" };
  }

  const stateVerdict = validateLeaveCalendarOperation(operation, request);

  if (!stateVerdict.ok) {
    return { outcome: "discarded", reason: stateVerdict.reason };
  }

  const calendarId =
    row.calendar_channel === "team_leave" ? gate.teamCalendarId : gate.sicknessCalendarId;

  if (operation === "delete") {
    const mapping = await loadActiveMapping(adminClient, {
      calendarChannel: row.calendar_channel,
      entityType: "leave_request",
      entityId: request.id,
    });

    if (!mapping) {
      return {
        outcome: "sent",
        syncProvider: gate.provider,
        mockDelivery: gate.mockDelivery,
      };
    }

    const deleted = await provider.deleteEvent(calendarId, mapping.google_event_id);
    await markMappingDeleted(adminClient, mapping.id);

    return {
      outcome: "sent",
      syncProvider: gate.provider,
      mockDelivery: !deleted.deliveredToGoogle,
    };
  }

  const employeeName = await loadEmployeeDisplayName(
    adminClient,
    row.employee_profile_id ?? request.profile_id
  );

  const payload = buildTeamLeaveCalendarEvent({
    request: {
      id: request.id,
      leaveKind: request.leave_kind as "annual" | "additional_paid",
      startDate: request.start_date,
      endDate: request.end_date,
      dayPortion: request.day_portion,
    },
    employeeName,
  });

  const existingMapping = await loadActiveMapping(adminClient, {
    calendarChannel: row.calendar_channel,
    entityType: "leave_request",
    entityId: request.id,
  });

  if (
    existingMapping &&
    existingMapping.content_fingerprint === payload.fingerprint &&
    !mappingNeedsGoogleResync(existingMapping, gate.provider)
  ) {
    return {
      outcome: "sent",
      syncProvider: existingMapping.sync_provider as "mock" | "google",
      mockDelivery: existingMapping.sync_provider === "mock",
    };
  }

  const upserted = await provider.upsertEvent(calendarId, payload);
  await upsertMapping(adminClient, {
    calendarChannel: row.calendar_channel,
    entityType: "leave_request",
    entityId: request.id,
    googleCalendarId: upserted.googleCalendarId,
    googleEventId: upserted.googleEventId,
    syncProvider: upserted.provider,
    fingerprint: payload.fingerprint,
    etag: upserted.etag,
  });

  return {
    outcome: "sent",
    syncProvider: upserted.provider,
    mockDelivery: !upserted.deliveredToGoogle,
  };
}

async function deliverSicknessCalendarOutboxRow(
  adminClient: SupabaseClient,
  row: CalendarOutboxRow,
  gate: ActiveDeliveryGate,
  provider: ReturnType<typeof createStaffLeaveCalendarSyncProvider>
): Promise<DeliveryOutcome> {
  if (!isStaffLeaveCalendarOperation(row.operation)) {
    return { outcome: "failed", errorMessage: "invalid_calendar_operation" };
  }

  const sicknessVerdict = validateSicknessCalendarOperation(row.operation);

  if (!sicknessVerdict.ok) {
    return { outcome: "discarded", reason: sicknessVerdict.reason };
  }

  const { data: sickness, error } = await adminClient
    .from("staff_absence_sickness")
    .select("id, start_date, end_date, day_portion, profile_id")
    .eq("id", row.sickness_id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!sickness) {
    return { outcome: "discarded", reason: "upsert_missing_sickness" };
  }

  const employeeName = await loadEmployeeDisplayName(
    adminClient,
    row.employee_profile_id ?? sickness.profile_id
  );

  const payload = buildSicknessCalendarEvent({
    sickness: {
      id: sickness.id,
      startDate: sickness.start_date,
      endDate: sickness.end_date,
      dayPortion: sickness.day_portion,
    },
    employeeName,
  });

  const existingMapping = await loadActiveMapping(adminClient, {
    calendarChannel: "sickness_management",
    entityType: "sickness",
    entityId: sickness.id,
  });

  if (
    existingMapping &&
    existingMapping.content_fingerprint === payload.fingerprint &&
    !mappingNeedsGoogleResync(existingMapping, gate.provider)
  ) {
    return {
      outcome: "sent",
      syncProvider: existingMapping.sync_provider as "mock" | "google",
      mockDelivery: existingMapping.sync_provider === "mock",
    };
  }

  const upserted = await provider.upsertEvent(gate.sicknessCalendarId, payload);

  await upsertMapping(adminClient, {
    calendarChannel: "sickness_management",
    entityType: "sickness",
    entityId: sickness.id,
    googleCalendarId: upserted.googleCalendarId,
    googleEventId: upserted.googleEventId,
    syncProvider: upserted.provider,
    fingerprint: payload.fingerprint,
    etag: upserted.etag,
  });

  return {
    outcome: "sent",
    syncProvider: upserted.provider,
    mockDelivery: !upserted.deliveredToGoogle,
  };
}

async function loadEmployeeDisplayName(adminClient: SupabaseClient, profileId: string) {
  const { data, error } = await adminClient
    .from("profiles")
    .select("full_name")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const name = data?.full_name?.trim();
  return name && name.length > 0 ? name : "Team member";
}

async function loadActiveMapping(
  adminClient: SupabaseClient,
  input: { calendarChannel: string; entityType: "leave_request" | "sickness"; entityId: string }
) {
  const { data, error } = await adminClient
    .from("staff_leave_calendar_event_mappings")
    .select(
      "id, google_event_id, google_calendar_id, sync_provider, content_fingerprint, deleted_at"
    )
    .eq("calendar_channel", input.calendarChannel)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return null;
    }

    throw error;
  }

  return data;
}

async function upsertMapping(
  adminClient: SupabaseClient,
  input: {
    calendarChannel: string;
    entityType: "leave_request" | "sickness";
    entityId: string;
    googleCalendarId: string;
    googleEventId: string;
    syncProvider: "mock" | "google";
    fingerprint: string;
    etag: string | null;
  }
) {
  const now = new Date().toISOString();

  const { error } = await adminClient.from("staff_leave_calendar_event_mappings").upsert(
    {
      calendar_channel: input.calendarChannel,
      entity_type: input.entityType,
      entity_id: input.entityId,
      google_calendar_id: input.googleCalendarId,
      google_event_id: input.googleEventId,
      sync_provider: input.syncProvider,
      content_fingerprint: input.fingerprint,
      google_etag: input.etag,
      last_synced_at: now,
      deleted_at: null,
      updated_at: now,
    },
    { onConflict: "calendar_channel,entity_type,entity_id" }
  );

  if (error) {
    throw error;
  }
}

async function markMappingDeleted(adminClient: SupabaseClient, mappingId: string) {
  const now = new Date().toISOString();

  const { error } = await adminClient
    .from("staff_leave_calendar_event_mappings")
    .update({ deleted_at: now, updated_at: now })
    .eq("id", mappingId);

  if (error) {
    throw error;
  }
}
