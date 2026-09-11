import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isNotificationsSchemaMissingError } from "@/lib/notifications/errors";
import { SLACK_JOB_TIMELINE_NOTIFICATION_TYPE } from "@/lib/slack/idempotency";

type SlackTimelineNotificationRow = {
  notification_type: string;
  channel: "slack";
  audience: "internal";
  company_id?: string | null;
  job_id?: string | null;
  quote_id?: string | null;
  status: string;
  provider?: string | null;
  provider_message_id?: string | null;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
  idempotency_key: string;
  sent_at?: string | null;
  failed_at?: string | null;
};

async function findNotificationByIdempotencyKey(
  adminClient: SupabaseClient,
  idempotencyKey: string
) {
  const { data, error } = await adminClient
    .from("notifications")
    .select("id, status, metadata, provider_message_id, error_message")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return null;
    }

    throw error;
  }

  return data;
}

export type ClaimSlackTimelineResult =
  | {
      shouldPost: true;
      notificationId: string | null;
      schemaMissing?: boolean;
    }
  | {
      shouldPost: false;
      reason: "already_sent" | "in_progress" | "schema_missing";
      notificationId?: string;
    };

export async function claimSlackJobTimelineNotification(
  adminClient: SupabaseClient,
  input: {
    jobId: string;
    companyId?: string | null;
    quoteId?: string | null;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }
): Promise<ClaimSlackTimelineResult> {
  const existing = await findNotificationByIdempotencyKey(
    adminClient,
    input.idempotencyKey
  );

  if (existing) {
    const status = existing.status as string;

    if (status === "sent" || status === "delivered") {
      return { shouldPost: false, reason: "already_sent", notificationId: existing.id as string };
    }

    if (status === "sending") {
      return { shouldPost: false, reason: "in_progress", notificationId: existing.id as string };
    }

    if (status === "failed") {
      await adminClient
        .from("notifications")
        .update({
          status: "sending",
          error_message: null,
          failed_at: null,
        })
        .eq("id", existing.id as string);

      return {
        shouldPost: true,
        notificationId: existing.id as string,
      };
    }

    return {
      shouldPost: true,
      notificationId: existing.id as string,
    };
  }

  const row: SlackTimelineNotificationRow = {
    notification_type: SLACK_JOB_TIMELINE_NOTIFICATION_TYPE,
    channel: "slack",
    audience: "internal",
    company_id: input.companyId ?? null,
    job_id: input.jobId,
    quote_id: input.quoteId ?? null,
    status: "sending",
    provider: "slack",
    idempotency_key: input.idempotencyKey,
    metadata: input.metadata ?? {},
  };

  const { data, error } = await adminClient
    .from("notifications")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (isNotificationsSchemaMissingError(error)) {
      return { shouldPost: false, reason: "schema_missing" };
    }

    if (error.code === "23505") {
      const raced = await findNotificationByIdempotencyKey(
        adminClient,
        input.idempotencyKey
      );

      if (raced?.status === "sent" || raced?.status === "delivered") {
        return { shouldPost: false, reason: "already_sent", notificationId: raced.id as string };
      }

      if (raced?.status === "sending") {
        return { shouldPost: false, reason: "in_progress", notificationId: raced.id as string };
      }
    }

    throw error;
  }

  return {
    shouldPost: true,
    notificationId: data.id as string,
    schemaMissing: false,
  };
}

export async function markSlackJobTimelineNotificationSent(
  adminClient: SupabaseClient,
  input: {
    notificationId: string;
    channelId: string;
    messageTs?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const now = new Date().toISOString();

  await adminClient
    .from("notifications")
    .update({
      status: "sent",
      provider_message_id: input.messageTs ?? input.channelId,
      sent_at: now,
      failed_at: null,
      error_message: null,
      metadata: input.metadata ?? {},
    })
    .eq("id", input.notificationId);
}

export async function markSlackJobTimelineNotificationFailed(
  adminClient: SupabaseClient,
  input: {
    notificationId: string | null;
    errorMessage: string;
    metadata?: Record<string, unknown>;
  }
) {
  if (!input.notificationId) {
    return;
  }

  const now = new Date().toISOString();

  await adminClient
    .from("notifications")
    .update({
      status: "failed",
      error_message: input.errorMessage,
      failed_at: now,
      metadata: input.metadata ?? {},
    })
    .eq("id", input.notificationId);
}
