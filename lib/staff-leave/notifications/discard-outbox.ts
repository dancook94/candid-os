import type { SupabaseClient } from "@supabase/supabase-js";

export const DISCARDABLE_OUTBOX_STATUSES = ["pending", "failed", "processing"] as const;

export type DiscardStaffLeaveOutboxInput = {
  outboxIds?: string[];
  requestIds?: string[];
  reason: string;
  dryRun?: boolean;
};

export type DiscardStaffLeaveOutboxResult = {
  matched: number;
  discarded: number;
  rows: Array<{ id: string; request_id: string; status: string }>;
};

export async function discardStaffLeaveNotificationOutbox(
  adminClient: SupabaseClient,
  input: DiscardStaffLeaveOutboxInput
): Promise<DiscardStaffLeaveOutboxResult> {
  const reason = input.reason.trim();

  if (!reason) {
    throw new Error("discard_reason_required");
  }

  const ids = input.outboxIds?.filter(Boolean) ?? [];
  const requestIds = input.requestIds?.filter(Boolean) ?? [];

  if (ids.length === 0 && requestIds.length === 0) {
    throw new Error("discard_target_required");
  }

  let query = adminClient
    .from("staff_leave_notification_outbox")
    .select("id, request_id, status")
    .in("status", [...DISCARDABLE_OUTBOX_STATUSES]);

  if (ids.length > 0) {
    query = query.in("id", ids);
  }

  if (requestIds.length > 0) {
    query = query.in("request_id", requestIds);
  }

  const { data: rows, error } = await query;

  if (error) {
    throw error;
  }

  const matched = rows ?? [];
  const sentLeak = matched.filter((row) => row.status === "sent");

  if (sentLeak.length > 0) {
    throw new Error("discard_sent_outbox_forbidden");
  }

  if (input.dryRun || matched.length === 0) {
    return { matched: matched.length, discarded: 0, rows: matched };
  }

  const now = new Date().toISOString();
  const matchedIds = matched.map((row) => row.id);

  const { error: updateError } = await adminClient
    .from("staff_leave_notification_outbox")
    .update({
      status: "discarded",
      discarded_at: now,
      discard_reason: reason,
      locked_at: null,
      processed_at: now,
      last_error: null,
    })
    .in("id", matchedIds)
    .in("status", [...DISCARDABLE_OUTBOX_STATUSES]);

  if (updateError) {
    throw updateError;
  }

  return {
    matched: matched.length,
    discarded: matched.length,
    rows: matched,
  };
}
