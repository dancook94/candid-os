import type { SupabaseClient } from "@supabase/supabase-js";

import { getStaffLeaveCalendarSyncConfig } from "@/lib/staff-leave/calendar-sync/config";
import { getStaffLeaveCalendarDeliveryGate } from "@/lib/staff-leave/calendar-sync/delivery-gate";
import { describeSyncProviderLabel } from "@/lib/staff-leave/calendar-sync/mapping-transition";

export type StaffLeaveCalendarSyncStatus = {
  integrationEnabled: boolean;
  providerMode: "mock" | "google" | "disabled";
  providerLabel: string;
  mockDeliveryOnly: boolean;
  teamCalendarConfigured: boolean;
  sicknessCalendarConfigured: boolean;
  outboxCounts: {
    pending: number;
    processing: number;
    sent: number;
    failed: number;
    discarded: number;
    mockSent: number;
    googleSent: number;
  };
  mappingCounts: {
    active: number;
    deleted: number;
    mockActive: number;
    googleActive: number;
  };
  lastSuccessfulProcessedAt: string | null;
  recentErrors: Array<{ id: string; lastError: string | null; processedAt: string | null }>;
  deliveryGateReason: string | null;
};

const OUTBOX_STATUSES = ["pending", "processing", "sent", "failed", "discarded"] as const;

export async function loadStaffLeaveCalendarSyncStatus(
  adminClient: SupabaseClient
): Promise<StaffLeaveCalendarSyncStatus> {
  const config = getStaffLeaveCalendarSyncConfig();
  const gate = getStaffLeaveCalendarDeliveryGate();

  const outboxCounts = {
    pending: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    discarded: 0,
    mockSent: 0,
    googleSent: 0,
  };

  const mappingCounts = {
    active: 0,
    deleted: 0,
    mockActive: 0,
    googleActive: 0,
  };

  let lastSuccessfulProcessedAt: string | null = null;
  const recentErrors: StaffLeaveCalendarSyncStatus["recentErrors"] = [];

  for (const status of OUTBOX_STATUSES) {
    const { count, error } = await adminClient
      .from("staff_leave_calendar_sync_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        return buildStatusSkeleton(config, gate);
      }

      throw error;
    }

    outboxCounts[status] = count ?? 0;
  }

  const { count: mockSent } = await adminClient
    .from("staff_leave_calendar_sync_outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .eq("sync_provider", "mock");

  const { count: googleSent } = await adminClient
    .from("staff_leave_calendar_sync_outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .eq("sync_provider", "google");

  outboxCounts.mockSent = mockSent ?? 0;
  outboxCounts.googleSent = googleSent ?? 0;

  const { data: lastSentRows, error: lastSentError } = await adminClient
    .from("staff_leave_calendar_sync_outbox")
    .select("processed_at")
    .eq("status", "sent")
    .order("processed_at", { ascending: false })
    .limit(1);

  if (lastSentError) {
    throw lastSentError;
  }

  lastSuccessfulProcessedAt = lastSentRows?.[0]?.processed_at ?? null;

  const { data: failedRows, error: failedError } = await adminClient
    .from("staff_leave_calendar_sync_outbox")
    .select("id, last_error, processed_at")
    .eq("status", "failed")
    .order("processed_at", { ascending: false })
    .limit(8);

  if (failedError) {
    throw failedError;
  }

  for (const row of failedRows ?? []) {
    recentErrors.push({
      id: row.id,
      lastError: row.last_error,
      processedAt: row.processed_at,
    });
  }

  const { data: mappings, error: mappingError } = await adminClient
    .from("staff_leave_calendar_event_mappings")
    .select("deleted_at, sync_provider");

  if (mappingError) {
    if (mappingError.code === "42P01" || mappingError.code === "PGRST205") {
      return buildStatusSkeleton(config, gate);
    }

    throw mappingError;
  }

  for (const row of mappings ?? []) {
    if (row.deleted_at) {
      mappingCounts.deleted += 1;
      continue;
    }

    mappingCounts.active += 1;
    if (row.sync_provider === "mock") {
      mappingCounts.mockActive += 1;
    } else if (row.sync_provider === "google") {
      mappingCounts.googleActive += 1;
    }
  }

  const providerMode =
    !config.enabled || !gate.allowed
      ? "disabled"
      : gate.allowed
        ? gate.provider
        : "disabled";

  return {
    integrationEnabled: config.enabled && gate.allowed,
    providerMode,
    providerLabel: describeSyncProviderLabel(
      providerMode === "disabled" ? null : providerMode
    ),
    mockDeliveryOnly: providerMode === "mock",
    teamCalendarConfigured: !config.teamCalendarId.startsWith("unconfigured"),
    sicknessCalendarConfigured: !config.sicknessCalendarId.startsWith("unconfigured"),
    outboxCounts,
    mappingCounts,
    lastSuccessfulProcessedAt,
    recentErrors,
    deliveryGateReason: gate.allowed ? null : gate.reason,
  };
}

function buildStatusSkeleton(
  config: ReturnType<typeof getStaffLeaveCalendarSyncConfig>,
  gate: ReturnType<typeof getStaffLeaveCalendarDeliveryGate>
): StaffLeaveCalendarSyncStatus {
  return {
    integrationEnabled: false,
    providerMode: "disabled",
    providerLabel: "Migration not applied",
    mockDeliveryOnly: true,
    teamCalendarConfigured: !config.teamCalendarId.startsWith("unconfigured"),
    sicknessCalendarConfigured: !config.sicknessCalendarId.startsWith("unconfigured"),
    outboxCounts: {
      pending: 0,
      processing: 0,
      sent: 0,
      failed: 0,
      discarded: 0,
      mockSent: 0,
      googleSent: 0,
    },
    mappingCounts: { active: 0, deleted: 0, mockActive: 0, googleActive: 0 },
    lastSuccessfulProcessedAt: null,
    recentErrors: [],
    deliveryGateReason: gate.allowed ? null : gate.reason,
  };
}
