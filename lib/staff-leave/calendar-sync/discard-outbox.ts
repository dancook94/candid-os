import type { SupabaseClient } from "@supabase/supabase-js";

export const DISCARDABLE_CALENDAR_OUTBOX_STATUSES = ["pending", "failed", "processing"] as const;

export type DiscardStaffLeaveCalendarOutboxInput = {
  outboxIds?: string[];
  leaveRequestIds?: string[];
  sicknessIds?: string[];
  reason: string;
  dryRun?: boolean;
};

export type DiscardStaffLeaveCalendarOutboxResult = {
  matched: number;
  discarded: number;
  rows: Array<{
    id: string;
    leave_request_id: string | null;
    sickness_id: string | null;
    status: string;
  }>;
};

export async function discardStaffLeaveCalendarSyncOutbox(
  adminClient: SupabaseClient,
  input: DiscardStaffLeaveCalendarOutboxInput
): Promise<DiscardStaffLeaveCalendarOutboxResult> {
  const reason = input.reason.trim();

  if (!reason) {
    throw new Error("discard_reason_required");
  }

  const ids = input.outboxIds?.filter(Boolean) ?? [];
  const leaveRequestIds = input.leaveRequestIds?.filter(Boolean) ?? [];
  const sicknessIds = input.sicknessIds?.filter(Boolean) ?? [];

  if (ids.length === 0 && leaveRequestIds.length === 0 && sicknessIds.length === 0) {
    throw new Error("discard_target_required");
  }

  let query = adminClient
    .from("staff_leave_calendar_sync_outbox")
    .select("id, leave_request_id, sickness_id, status, sync_provider")
    .in("status", [...DISCARDABLE_CALENDAR_OUTBOX_STATUSES]);

  if (ids.length > 0) {
    query = query.in("id", ids);
  }

  if (leaveRequestIds.length > 0) {
    query = query.in("leave_request_id", leaveRequestIds);
  }

  if (sicknessIds.length > 0) {
    query = query.in("sickness_id", sicknessIds);
  }

  const { data: rows, error } = await query;

  if (error) {
    throw error;
  }

  const matched = rows ?? [];

  if (matched.some((row) => row.sync_provider === "google")) {
    throw new Error("discard_google_delivered_outbox_forbidden");
  }

  if (input.dryRun || matched.length === 0) {
    return { matched: matched.length, discarded: 0, rows: matched };
  }

  const now = new Date().toISOString();
  const matchedIds = matched.map((row) => row.id);

  const { error: updateError } = await adminClient
    .from("staff_leave_calendar_sync_outbox")
    .update({
      status: "discarded",
      discarded_at: now,
      discard_reason: reason,
      locked_at: null,
      processed_at: now,
      last_error: null,
    })
    .in("id", matchedIds)
    .in("status", [...DISCARDABLE_CALENDAR_OUTBOX_STATUSES]);

  if (updateError) {
    throw updateError;
  }

  return { matched: matched.length, discarded: matched.length, rows: matched };
}
