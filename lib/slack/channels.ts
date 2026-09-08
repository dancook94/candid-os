import "server-only";

import { getSlackConfig } from "@/lib/slack/config";
import { buildJobSlackChannelName } from "@/lib/slack/channel-name";
import { chunkSlackUserIds, mergeInviteAttemptResults } from "@/lib/slack/member-eligibility";
import type { SlackInviteAttemptResult } from "@/lib/slack/member-eligibility";
import { slackApi } from "@/lib/slack/client";
import { SlackError } from "@/lib/slack/errors";

type ConversationsCreateResponse = {
  channel?: {
    id: string;
    name?: string;
    is_private?: boolean;
  };
};

const MAX_NAME_COLLISION_ATTEMPTS = 8;
const INVITE_BATCH_SIZE = 100;

async function inviteSlackUserBatch(
  channelId: string,
  userIds: string[]
): Promise<SlackInviteAttemptResult> {
  if (userIds.length === 0) {
    return { invited: [], failed: [] };
  }

  try {
    await slackApi<{ channel?: { id: string } }>("conversations.invite", {
      channel: channelId,
      users: userIds.join(","),
    });

    return { invited: userIds, failed: [] };
  } catch (error) {
    if (
      error instanceof SlackError &&
      (error.slackError === "already_in_channel" || error.slackError === "cant_invite_self")
    ) {
      return { invited: userIds, failed: [] };
    }

    if (userIds.length === 1) {
      const message =
        error instanceof SlackError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Invite failed.";

      return {
        invited: [],
        failed: [{ userId: userIds[0] as string, error: message }],
      };
    }

    const nestedResults: SlackInviteAttemptResult[] = [];

    for (const userId of userIds) {
      nestedResults.push(await inviteSlackUserBatch(channelId, [userId]));
    }

    return mergeInviteAttemptResults(nestedResults);
  }
}

export async function createJobSlackChannel(input: {
  jobReference: string;
  companyName: string;
  projectName: string;
}) {
  const config = getSlackConfig();
  let collisionSuffix = "";

  for (let attempt = 0; attempt < MAX_NAME_COLLISION_ATTEMPTS; attempt += 1) {
    const name = buildJobSlackChannelName({
      jobReference: input.jobReference,
      companyName: input.companyName,
      projectName: input.projectName,
      prefix: config.channelNamePrefix,
      collisionSuffix,
    });

    try {
      const response = await slackApi<ConversationsCreateResponse>("conversations.create", {
        name,
        is_private: config.jobChannelsPrivate,
      });

      const channelId = response.channel?.id;

      if (!channelId) {
        throw new SlackError("Slack did not return a channel ID.", "missing_channel_id", 502);
      }

      return {
        channelId,
        channelName: response.channel?.name ?? name,
        isPrivate: response.channel?.is_private ?? config.jobChannelsPrivate,
      };
    } catch (error) {
      if (
        error instanceof SlackError &&
        error.slackError === "name_taken" &&
        attempt < MAX_NAME_COLLISION_ATTEMPTS - 1
      ) {
        collisionSuffix = `-${attempt + 2}`;
        continue;
      }

      throw error;
    }
  }

  throw new SlackError("Unable to allocate a unique Slack channel name.", "name_collision", 502);
}

export async function inviteUsersToSlackChannel(
  channelId: string,
  userIds: string[]
): Promise<SlackInviteAttemptResult> {
  if (userIds.length === 0) {
    return { invited: [], failed: [] };
  }

  const batches = chunkSlackUserIds(userIds, INVITE_BATCH_SIZE);
  const results: SlackInviteAttemptResult[] = [];

  for (const batch of batches) {
    results.push(await inviteSlackUserBatch(channelId, batch));
  }

  return mergeInviteAttemptResults(results);
}

type ChatPostMessageResponse = {
  ts?: string;
  channel?: string;
};

export async function postSlackChannelMessage(input: {
  channelId: string;
  text: string;
  blocks: Array<Record<string, unknown>>;
}) {
  const response = await slackApi<ChatPostMessageResponse>("chat.postMessage", {
    channel: input.channelId,
    text: input.text,
    blocks: input.blocks,
    unfurl_links: false,
    unfurl_media: false,
  });

  return {
    messageTs: response.ts ?? null,
    channelId: response.channel ?? input.channelId,
  };
}
