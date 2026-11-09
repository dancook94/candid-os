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
import {
  STAFF_LEAVE_OUTBOX_DEFAULT_BATCH_LIMIT,
  STAFF_LEAVE_OUTBOX_MAX_ATTEMPTS,
  STAFF_LEAVE_OUTBOX_STALE_LOCK_MS,
} from "@/lib/staff-leave/notifications/outbox-constants";

type OutboxRow = {
  id: string;
  source_event_id: string;
  notification_kind: string;
  request_id: string;
  employee_profile_id: string;
  status: string;
  attempts: number;
  locked_at?: string | null;
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

export { STAFF_LEAVE_OUTBOX_MAX_ATTEMPTS, STAFF_LEAVE_OUTBOX_STALE_LOCK_MS };

export function staleStaffLeaveOutboxLockCutoff(nowMs = Date.now()) {
  return new Date(nowMs - STAFF_LEAVE_OUTBOX_STALE_LOCK_MS).toISOString();
}

export function isStaleStaffLeaveOutboxLock(
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

  return nowMs - lockedMs >= STAFF_LEAVE_OUTBOX_STALE_LOCK_MS;
}

export function buildStaffLeaveOutboxClaimFilter(staleCutoffIso: string) {
  return [
    "status.in.(pending,failed)",
    `and(status.eq.processing,locked_at.lt.${staleCutoffIso})`,
    "and(status.eq.processing,locked_at.is.null)",
  ].join(",");
}

export async function processStaffLeaveNotificationOutbox(
  adminClient: SupabaseClient,
  input?: { outboxId?: string; requestId?: string; limit?: number }
): Promise<ProcessStaffLeaveOutboxResult> {
  const limit =
    input?.outboxId != null && input.outboxId !== ""
      ? 1
      : input?.limit ?? STAFF_LEAVE_OUTBOX_DEFAULT_BATCH_LIMIT;
  const staleCutoff = staleStaffLeaveOutboxLockCutoff();
  const claimFilter = buildStaffLeaveOutboxClaimFilter(staleCutoff);

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
      "id, source_event_id, notification_kind, request_id, employee_profile_id, status, attempts, locked_at"
    )
    .or(claimFilter)
    .lt("attempts", STAFF_LEAVE_OUTBOX_MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (input?.outboxId) {
    query = query.eq("id", input.outboxId);
  } else if (input?.requestId) {
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
      const claimed = await claimOutboxRow(adminClient, row, claimFilter);

      if (!claimed) {
        result.skipped += 1;
        continue;
      }

      try {
        await markOutboxFailed(adminClient, row, deliveryGate.reason);
        result.failed += 1;
        result.errors.push(deliveryGate.reason);
      } catch (markError) {
        result.errors.push(toErrorMessage(markError));
      }
    }

    return result;
  }

  for (const row of (pendingRows ?? []) as OutboxRow[]) {
    result.processed += 1;

    const claimed = await claimOutboxRow(adminClient, row, claimFilter);

    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    try {
      const alreadySent = await notificationAlreadyDelivered(adminClient, row.source_event_id);

      if (alreadySent) {
        await markOutboxSent(adminClient, row.id);
        result.sent += 1;
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
    } catch (error) {
      const message = toErrorMessage(error);

      try {
        await markOutboxFailed(adminClient, row, message);
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

async function claimOutboxRow(
  adminClient: SupabaseClient,
  row: OutboxRow,
  claimFilter: string
) {
  const now = new Date().toISOString();

  const { data, error } = await adminClient
    .from("staff_leave_notification_outbox")
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

async function notificationAlreadyDelivered(
  adminClient: SupabaseClient,
  sourceEventId: string
) {
  const idempotencyKey = staffLeaveNotificationIdempotencyKey(sourceEventId);

  const { data, error } = await adminClient
    .from("notifications")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return false;
    }

    throw error;
  }

  if (!data) {
    return false;
  }

  const status = String(data.status);
  return status === "sent" || status === "delivered";
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

  const requestResult = await loadLeaveRequest(adminClient, row.request_id);

  if (requestResult.errorMessage) {
    return { ok: false, errorMessage: requestResult.errorMessage };
  }

  if (!requestResult.request) {
    return { ok: false, errorMessage: "missing_leave_request" };
  }

  const request = requestResult.request;

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

  if (sendResult.duplicate) {
    return { ok: true, errorMessage: null };
  }

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

async function loadLeaveRequest(
  adminClient: SupabaseClient,
  requestId: string
): Promise<{
  request: LeaveRequestRow | null;
  errorMessage: string | null;
}> {
  const { data, error } = await adminClient
    .from("staff_leave_requests")
    .select("id, leave_kind, status, start_date, end_date, days_requested")
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    if (error.code === "42501") {
      return {
        request: null,
        errorMessage: "staff_leave_requests_select_denied",
      };
    }

    return {
      request: null,
      errorMessage: error.message || "staff_leave_request_load_failed",
    };
  }

  return {
    request: (data as LeaveRequestRow | null) ?? null,
    errorMessage: null,
  };
}
