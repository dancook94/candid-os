export const SLACKBOT_USER_ID = "USLACKBOT";

export type SlackMemberCandidate = {
  id: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_stranger?: boolean;
  is_invited_user?: boolean;
};

export type SlackMemberEligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string };

export function getSlackMemberEligibility(
  user: SlackMemberCandidate
): SlackMemberEligibilityResult {
  if (user.id === SLACKBOT_USER_ID) {
    return { eligible: false, reason: "slackbot" };
  }

  if (user.deleted) {
    return { eligible: false, reason: "deactivated" };
  }

  if (user.is_bot) {
    return { eligible: false, reason: "bot" };
  }

  if (user.is_app_user) {
    return { eligible: false, reason: "app_user" };
  }

  if (user.is_restricted) {
    return { eligible: false, reason: "single_channel_guest" };
  }

  if (user.is_ultra_restricted) {
    return { eligible: false, reason: "multi_channel_guest" };
  }

  if (user.is_stranger) {
    return { eligible: false, reason: "external_stranger" };
  }

  if (user.is_invited_user) {
    return { eligible: false, reason: "pending_invite" };
  }

  return { eligible: true };
}

export function isEligibleSlackMember(user: SlackMemberCandidate) {
  return getSlackMemberEligibility(user).eligible;
}

export function filterEligibleSlackMemberIds(
  users: SlackMemberCandidate[],
  excludeUserIds: string[] = []
) {
  const excluded = new Set(excludeUserIds);

  return users
    .filter((user) => !excluded.has(user.id))
    .filter((user) => isEligibleSlackMember(user))
    .map((user) => user.id);
}

export function chunkSlackUserIds(userIds: string[], batchSize: number) {
  if (batchSize <= 0) {
    throw new Error("batchSize must be greater than zero.");
  }

  const batches: string[][] = [];

  for (let index = 0; index < userIds.length; index += batchSize) {
    batches.push(userIds.slice(index, index + batchSize));
  }

  return batches;
}

export function mergeJobChannelInviteUserIds(
  workspaceMemberIds: string[],
  extraUserIds: string[] = [],
  excludeUserIds: string[] = []
) {
  const excluded = new Set(excludeUserIds);

  return [
    ...new Set(
      [...workspaceMemberIds, ...extraUserIds].filter((userId) => !excluded.has(userId))
    ),
  ];
}

export type SlackInviteAttemptResult = {
  invited: string[];
  failed: Array<{ userId: string; error: string }>;
};

export function mergeInviteAttemptResults(
  results: SlackInviteAttemptResult[]
): SlackInviteAttemptResult {
  return {
    invited: [...new Set(results.flatMap((result) => result.invited))],
    failed: results.flatMap((result) => result.failed),
  };
}
