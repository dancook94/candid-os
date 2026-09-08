import "server-only";

import { slackApi } from "@/lib/slack/client";
import {
  filterEligibleSlackMemberIds,
  mergeJobChannelInviteUserIds,
  type SlackMemberCandidate,
} from "@/lib/slack/member-eligibility";
import type { SlackConfig } from "@/lib/slack/config";

type UsersListResponse = {
  members?: SlackMemberCandidate[];
  response_metadata?: {
    next_cursor?: string;
  };
};

type AuthTestResponse = {
  user_id?: string;
};

const USERS_LIST_PAGE_SIZE = 200;

export async function getSlackBotUserId() {
  const response = await slackApi<AuthTestResponse>("auth.test", {});
  return response.user_id?.trim() || null;
}

export async function listSlackWorkspaceMembers() {
  const members: SlackMemberCandidate[] = [];
  let cursor: string | undefined;

  do {
    const response = await slackApi<UsersListResponse>("users.list", {
      limit: USERS_LIST_PAGE_SIZE,
      cursor,
    });

    members.push(...(response.members ?? []));
    cursor = response.response_metadata?.next_cursor?.trim() || undefined;
  } while (cursor);

  return members;
}

export async function listEligibleSlackWorkspaceMemberIds(excludeUserIds: string[] = []) {
  const members = await listSlackWorkspaceMembers();
  return filterEligibleSlackMemberIds(members, excludeUserIds);
}

export async function resolveJobChannelInviteUserIds(config: SlackConfig) {
  const excludeUserIds: string[] = [];

  try {
    const botUserId = await getSlackBotUserId();
    if (botUserId) {
      excludeUserIds.push(botUserId);
    }
  } catch {
    // Bot exclusion is best-effort; membership discovery should continue.
  }

  let workspaceMemberIds: string[] = [];
  let discoveryWarning: string | undefined;

  if (config.inviteAllActiveMembers) {
    try {
      workspaceMemberIds = await listEligibleSlackWorkspaceMemberIds(excludeUserIds);
    } catch (error) {
      discoveryWarning =
        error instanceof Error
          ? error.message
          : "Slack workspace member discovery failed.";
    }
  }

  const userIds = mergeJobChannelInviteUserIds(
    workspaceMemberIds,
    config.extraInviteUserIds,
    excludeUserIds
  );

  return {
    userIds,
    discoveryWarning,
    workspaceMemberCount: workspaceMemberIds.length,
  };
}
