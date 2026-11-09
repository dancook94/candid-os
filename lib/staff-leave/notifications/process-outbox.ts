import type { SupabaseClient } from "@supabase/supabase-js";

import { loadProfileNotificationContext } from "@/lib/notifications/profile-recipient";
import { sendNotification } from "@/lib/notifications/send-notification";

import { buildStaffLeaveEmailMetadata } from "@/lib/staff-leave/notifications/build-metadata";
import { getStaffLeaveDeliveryGate } from "@/lib/staff-leave/notifications/delivery-safety";
import { isStaffLeaveOutboxKind } from "@/lib/staff-leave/notifications/kinds";
import {
  mapOutboxKindToNotificationType,
  staffLeaveNotificationIdempotencyKey,
} from "@/lib/staff-leave/notifications/map-kind";

const DEFAULT_BATCH_LIMIT = 15;
const MAX_ATTEMPTS = 5;

type OutboxRow = {
  id: string;
  source_event_id: string;
  notification_kind: string;
  request_id: string;
  employee_profile_id: string;
  status: string;
  attempts: number;
};

type LeaveRequestRow = {
  id: string;
  leave_kind: string;
  status: string;
  start_date: string;
  end_date: string;
  days_requested: number;
};

export type ProcessStaffLeaveOutboxResult = {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
};

export async function processStaffLeaveNotificationOutbox(
  adminClient: SupabaseClient,
  input?: { requestId?: string; limit?: number }
): Promise<ProcessStaffLeaveOutboxResult> {
  const limit = input?.limit ?? DEFAULT_BATCH_LIMIT;
  const result: ProcessStaffLeaveOutboxResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  let query = adminClient
    .from("staff_leave_notification_outbox")
    .select(
      "id, source_event_id, notification_kind, request_id, employee_profile_id, status, attempts"
    )
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (input?.requestId) {
    query = query.eq("request_id", input.requestId);
  }

  const deliveryGate = getStaffLeaveDeliveryGate();

  const { data: pendingRows, error: fetchError } = await query;

  if (fetchError) {
    if (fetchError.code === "42P01" || fetchError.code === "PGRST205") {
      result.skipped += 1;
      result.errors.push("staff_leave_notification_outbox_missing");
      return result;
    }

    throw fetchError;
  }

  if (!deliveryGate.allowed) {
    for (const row of (pendingRows ?? []) as OutboxRow[]) {
      result.processed += 1;
      const claimed = await claimOutboxRow(adminClient, row);
      if (!claimed) {
        result.skipped += 1;
        continue;
      }
      await markOutboxFailed(adminClient, row, deliveryGate.reason);
      result.failed += 1;
      result.errors.push(deliveryGate.reason);
    }

    return result;
  }

  for (const row of (pendingRows ?? []) as OutboxRow[]) {
    result.processed += 1;

    const claimed = await claimOutboxRow(adminClient, row);

    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    const delivery = await deliverOutboxRow(adminClient, row, deliveryGate);

    if (delivery.ok) {
      await markOutboxSent(adminClient, row.id);
      result.sent += 1;
    } else {
      await markOutboxFailed(adminClient, row, delivery.errorMessage);
      result.failed += 1;
      if (delivery.errorMessage) {
        result.errors.push(delivery.errorMessage);
      }
    }
  }

  return result;
}

async function claimOutboxRow(adminClient: SupabaseClient, row: OutboxRow) {
  const now = new Date().toISOString();

  const { data, error } = await adminClient
    .from("staff_leave_notification_outbox")
    .update({ status: "processing", locked_at: now })
    .eq("id", row.id)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data?.id);
}

async function markOutboxSent(adminClient: SupabaseClient, outboxId: string) {
  const now = new Date().toISOString();

  const { error } = await adminClient
    .from("staff_leave_notification_outbox")
    .update({
      status: "sent",
      processed_at: now,
      last_error: null,
    })
    .eq("id", outboxId);

  if (error) {
    throw error;
  }
}

async function markOutboxFailed(
  adminClient: SupabaseClient,
  row: OutboxRow,
  errorMessage: string | null
) {
  const now = new Date().toISOString();

  const { error } = await adminClient
    .from("staff_leave_notification_outbox")
    .update({
      status: "failed",
      attempts: row.attempts + 1,
      last_error: errorMessage,
      processed_at: now,
    })
    .eq("id", row.id);

  if (error) {
    throw error;
  }
}

async function deliverOutboxRow(
  adminClient: SupabaseClient,
  row: OutboxRow,
  deliveryGate: Extract<
    ReturnType<typeof getStaffLeaveDeliveryGate>,
    { allowed: true }
  >
) {
  if (!isStaffLeaveOutboxKind(row.notification_kind)) {
    return { ok: false, errorMessage: "invalid_notification_kind" };
  }

  const request = await loadLeaveRequest(adminClient, row.request_id);

  if (!request) {
    return { ok: false, errorMessage: "missing_leave_request" };
  }

  const employee = await loadProfileNotificationContext(adminClient, row.employee_profile_id);

  if (!employee) {
    return { ok: false, errorMessage: "missing_employee_profile" };
  }

  const metadata = buildStaffLeaveEmailMetadata(row.notification_kind, {
    requestId: request.id,
    leaveKind: request.leave_kind,
    status: request.status,
    startDate: request.start_date,
    endDate: request.end_date,
    daysRequested: request.days_requested,
    employeeName: employee.fullName ?? employee.firstName ?? "Team member",
  });

  const target = mapOutboxKindToNotificationType(row.notification_kind);

  const sendResult = await sendNotification(adminClient, {
    type: target.type,
    profileId: target.audience === "staff" ? row.employee_profile_id : null,
    metadata,
    idempotencyKey: staffLeaveNotificationIdempotencyKey(row.source_event_id),
    recipientEmailOverride: deliveryGate.recipientOverride,
  });

  if (!sendResult.ok) {
    const reason =
      sendResult.failureReason ??
      sendResult.skippedReason ??
      sendResult.adminMessage ??
      "notification_send_failed";

    const configurationFailure =
      sendResult.skippedReason === "missing_internal_recipients" ||
      sendResult.skippedReason === "missing_recipient";

    if (configurationFailure) {
      return { ok: false, errorMessage: String(reason) };
    }

    const benignSkip = sendResult.skippedReason === "suppressed_by_admin_setting";

    return {
      ok: benignSkip,
      errorMessage: benignSkip ? null : String(reason),
    };
  }

  return { ok: true, errorMessage: null };
}

async function loadLeaveRequest(adminClient: SupabaseClient, requestId: string) {
  const { data, error } = await adminClient
    .from("staff_leave_requests")
    .select("id, leave_kind, status, start_date, end_date, days_requested")
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as LeaveRequestRow | null;
}
