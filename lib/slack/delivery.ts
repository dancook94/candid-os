import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isNotificationsSchemaMissingError } from "@/lib/notifications/errors";

import {
  buildSlackJobChannelIdempotencyKey,
  SLACK_JOB_CHANNEL_NOTIFICATION_TYPE,
} from "@/lib/slack/idempotency";

export { buildSlackJobChannelIdempotencyKey, SLACK_JOB_CHANNEL_NOTIFICATION_TYPE } from "@/lib/slack/idempotency";

type SlackNotificationRow = {
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

export async function claimSlackJobChannelNotification(
  adminClient: SupabaseClient,
  input: {
    jobId: string;
    companyId?: string | null;
    quoteId?: string | null;
  }
) {
  const idempotencyKey = buildSlackJobChannelIdempotencyKey(input.jobId);
  const existing = await findNotificationByIdempotencyKey(adminClient, idempotencyKey);

  if (existing) {
    return {
      claimed: false as const,
      notificationId: existing.id as string,
      status: existing.status as string,
      metadata: (existing.metadata as Record<string, unknown> | null) ?? {},
    };
  }

  const row: SlackNotificationRow = {
    notification_type: SLACK_JOB_CHANNEL_NOTIFICATION_TYPE,
    channel: "slack",
    audience: "internal",
    company_id: input.companyId ?? null,
    job_id: input.jobId,
    quote_id: input.quoteId ?? null,
    status: "sending",
    provider: "slack",
    idempotency_key: idempotencyKey,
    metadata: {
      phase: "job_channel_created",
    },
  };

  const { data, error } = await adminClient
    .from("notifications")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (isNotificationsSchemaMissingError(error)) {
      return {
        claimed: true as const,
        notificationId: null,
        schemaMissing: true as const,
      };
    }

    if (error.code === "23505") {
      const raced = await findNotificationByIdempotencyKey(adminClient, idempotencyKey);

      if (raced) {
        return {
          claimed: false as const,
          notificationId: raced.id as string,
          status: raced.status as string,
          metadata: (raced.metadata as Record<string, unknown> | null) ?? {},
        };
      }
    }

    throw error;
  }

  return {
    claimed: true as const,
    notificationId: data.id as string,
    schemaMissing: false as const,
  };
}

export async function markSlackJobChannelNotificationSent(
  adminClient: SupabaseClient,
  input: {
    notificationId: string;
    channelId: string;
    channelName: string;
    messageTs?: string | null;
    inviteFailures?: Array<{ userId: string; error: string }>;
    inviteDiscoveryWarning?: string | null;
    invitedMemberCount?: number;
    workspaceMemberCount?: number;
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
      error_message: input.inviteDiscoveryWarning ?? null,
      metadata: {
        channelId: input.channelId,
        channelName: input.channelName,
        messageTs: input.messageTs ?? null,
        inviteFailures: input.inviteFailures ?? [],
        inviteDiscoveryWarning: input.inviteDiscoveryWarning ?? null,
        invitedMemberCount: input.invitedMemberCount ?? null,
        workspaceMemberCount: input.workspaceMemberCount ?? null,
      },
    })
    .eq("id", input.notificationId);
}

export async function markSlackJobChannelNotificationFailed(
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

export async function findSlackJobChannelNotification(
  adminClient: SupabaseClient,
  jobId: string
) {
  return findNotificationByIdempotencyKey(
    adminClient,
    buildSlackJobChannelIdempotencyKey(jobId)
  );
}
