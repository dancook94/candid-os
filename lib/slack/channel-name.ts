const SLACK_CHANNEL_NAME_MAX_LENGTH = 80;

export function slugifyChannelSegment(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function buildJobSlackChannelName(input: {
  jobReference: string;
  projectName: string;
  prefix?: string;
  collisionSuffix?: string;
  /** Ignored — kept for call-site compatibility only. */
  companyName?: string;
}) {
  const prefix = input.prefix ?? "";
  const suffix = input.collisionSuffix ?? "";
  const jobRef = slugifyChannelSegment(input.jobReference);
  const project = slugifyChannelSegment(input.projectName);

  const reserved = prefix.length + suffix.length;
  const separatorLength = project ? 1 : 0;
  const maxProjectLength = Math.max(
    SLACK_CHANNEL_NAME_MAX_LENGTH - reserved - jobRef.length - separatorLength,
    0
  );

  const projectSegment =
    maxProjectLength > 0 ? project.slice(0, maxProjectLength).replace(/-+$/g, "") : "";

  const core = [jobRef, projectSegment].filter(Boolean).join("-");
  const name = `${prefix}${core}${suffix}`.replace(/-+/g, "-").replace(/^-|-$/g, "");

  return name.slice(0, SLACK_CHANNEL_NAME_MAX_LENGTH).replace(/-+$/g, "");
}

export function buildSlackChannelOpenUrl(channelId: string) {
  return `https://slack.com/app_redirect?channel=${encodeURIComponent(channelId)}`;
}
