import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { postSlackChannelMessage } from "@/lib/slack/channels";
import { isSlackEnabled } from "@/lib/slack/config";
import { isSlackError } from "@/lib/slack/errors";
import {
  buildSlackJobTimelineDeadlineIdempotencyKey,
  buildSlackJobTimelineStageIdempotencyKey,
} from "@/lib/slack/idempotency";
import {
  claimSlackJobTimelineNotification,
  markSlackJobTimelineNotificationFailed,
  markSlackJobTimelineNotificationSent,
} from "@/lib/slack/timeline-delivery";
import {
  buildProductionStageChangedTimelineMessage,
  resolveDeadlineTimelineMessage,
} from "@/lib/slack/timeline-messages";

export async function resolveSlackActorDisplayName(
  adminClient: SupabaseClient,
  profileId: string | null | undefined
): Promise<string | null> {
  if (!profileId?.trim()) {
    return null;
  }

  try {
    const { data, error } = await adminClient
      .from("profiles")
      .select("full_name")
      .eq("id", profileId.trim())
      .maybeSingle();

    if (error || !data?.full_name) {
      return null;
    }

    return data.full_name.trim() || null;
  } catch {
    return null;
  }
}

type SlackJobChannelRow = {
  slack_channel_id: string | null;
  company_id: string;
  quote_id: string | null;
};

async function loadJobSlackChannelRow(adminClient: SupabaseClient, jobId: string) {
  const { data, error } = await adminClient
    .from("jobs")
    .select("slack_channel_id, company_id, quote_id")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as SlackJobChannelRow;
}

async function postTimelineMessageSafe(
  adminClient: SupabaseClient,
  input: {
    jobId: string;
    idempotencyKey: string;
    timelineKind: string;
    message: { text: string; blocks: Array<Record<string, unknown>> };
    metadata?: Record<string, unknown>;
  }
) {
  if (!isSlackEnabled()) {
    return;
  }

  const jobRow = await loadJobSlackChannelRow(adminClient, input.jobId);
  const channelId = jobRow?.slack_channel_id?.trim();

  if (!channelId) {
    return;
  }

  let notificationId: string | null = null;

  try {
    const claim = await claimSlackJobTimelineNotification(adminClient, {
      jobId: input.jobId,
      companyId: jobRow?.company_id ?? null,
      quoteId: jobRow?.quote_id ?? null,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        timelineKind: input.timelineKind,
        ...input.metadata,
      },
    });

    if (!claim.shouldPost) {
      return;
    }

    notificationId = claim.notificationId;

    const posted = await postSlackChannelMessage({
      channelId,
      text: input.message.text,
      blocks: input.message.blocks,
    });

    if (notificationId) {
      await markSlackJobTimelineNotificationSent(adminClient, {
        notificationId,
        channelId,
        messageTs: posted.messageTs,
        metadata: {
          timelineKind: input.timelineKind,
          channelId,
          messageTs: posted.messageTs ?? null,
          ...input.metadata,
        },
      });
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Slack job timeline post failed.";

    try {
      await markSlackJobTimelineNotificationFailed(adminClient, {
        notificationId,
        errorMessage,
        metadata: {
          timelineKind: input.timelineKind,
          slackError: isSlackError(error)
            ? {
                code: error.code,
                slackError: error.slackError ?? null,
              }
            : null,
          ...input.metadata,
        },
      });
    } catch {
      // Best-effort failure recording.
    }

    if (process.env.NODE_ENV === "development") {
      console.error("[slack] job timeline post failed", {
        jobId: input.jobId,
        timelineKind: input.timelineKind,
        message: errorMessage,
      });
    }
  }
}

export async function postJobProductionDeadlineTimelineEventSafe(
  adminClient: SupabaseClient,
  input: {
    jobId: string;
    oldDate: string | null;
    newDate: string | null;
    actorProfileId?: string | null;
  }
) {
  const message = resolveDeadlineTimelineMessage({
    oldDate: input.oldDate,
    newDate: input.newDate,
    actorName: input.actorProfileId
      ? await resolveSlackActorDisplayName(adminClient, input.actorProfileId)
      : null,
  });

  if (!message) {
    return;
  }

  const idempotencyKey = buildSlackJobTimelineDeadlineIdempotencyKey(
    input.jobId,
    input.oldDate,
    input.newDate
  );

  const timelineKind =
    !input.oldDate && input.newDate
      ? "deadline_set"
      : input.oldDate && input.newDate
        ? "deadline_changed"
        : "deadline_cleared";

  await postTimelineMessageSafe(adminClient, {
    jobId: input.jobId,
    idempotencyKey,
    timelineKind,
    message,
    metadata: {
      oldDate: input.oldDate,
      newDate: input.newDate,
    },
  });
}

export async function postJobProductionStageTimelineEventSafe(
  adminClient: SupabaseClient,
  input: {
    jobId: string;
    historyRowId: string;
    previousLabel: string;
    newLabel: string;
    actorProfileId?: string | null;
  }
) {
  const actorName = input.actorProfileId
    ? await resolveSlackActorDisplayName(adminClient, input.actorProfileId)
    : null;

  const message = buildProductionStageChangedTimelineMessage({
    previousLabel: input.previousLabel,
    newLabel: input.newLabel,
    actorName,
  });

  const idempotencyKey = buildSlackJobTimelineStageIdempotencyKey(
    input.jobId,
    input.historyRowId
  );

  await postTimelineMessageSafe(adminClient, {
    jobId: input.jobId,
    idempotencyKey,
    timelineKind: "stage_changed",
    message,
    metadata: {
      historyRowId: input.historyRowId,
      previousLabel: input.previousLabel,
      newLabel: input.newLabel,
    },
  });
}
