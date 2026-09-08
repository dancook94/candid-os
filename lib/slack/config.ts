export type SlackConfig = {
  enabled: boolean;
  botToken: string | null;
  inviteAllActiveMembers: boolean;
  extraInviteUserIds: string[];
  jobChannelsPrivate: boolean;
  channelNamePrefix: string;
  appBaseUrl: string | null;
};

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseInviteUserIds(value: string | undefined) {
  if (!value?.trim()) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  ];
}

export function getSlackConfig(): SlackConfig {
  const botToken =
    process.env.SLACK_BOT_TOKEN?.trim() || process.env.SLACK_BOT_USER_OAUTH_TOKEN?.trim() || null;

  const enabled = parseBoolean(process.env.SLACK_ENABLED, false) && Boolean(botToken);

  return {
    enabled,
    botToken,
    inviteAllActiveMembers: parseBoolean(process.env.SLACK_INVITE_ALL_ACTIVE_MEMBERS, true),
    extraInviteUserIds: parseInviteUserIds(process.env.SLACK_DEFAULT_INVITE_USER_IDS),
    jobChannelsPrivate: parseBoolean(process.env.SLACK_JOB_CHANNELS_PRIVATE, true),
    channelNamePrefix: process.env.SLACK_CHANNEL_NAME_PREFIX?.trim() ?? "",
    appBaseUrl: process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || null,
  };
}

export function isSlackEnabled() {
  return getSlackConfig().enabled;
}
