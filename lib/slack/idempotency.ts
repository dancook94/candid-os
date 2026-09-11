export const SLACK_JOB_CHANNEL_NOTIFICATION_TYPE = "slack_job_channel_created";
export const SLACK_JOB_TIMELINE_NOTIFICATION_TYPE = "slack_job_timeline_event";

export function buildSlackJobChannelIdempotencyKey(jobId: string) {
  return `slack:job_channel_created:${jobId}`;
}

function normalizeDeadlineKeyPart(value: string | null | undefined) {
  if (value == null || value === "") {
    return "none";
  }

  return value.trim();
}

export function buildSlackJobTimelineDeadlineIdempotencyKey(
  jobId: string,
  oldDate: string | null | undefined,
  newDate: string | null | undefined
) {
  return `slack:job_timeline:${jobId}:deadline:${normalizeDeadlineKeyPart(oldDate)}:${normalizeDeadlineKeyPart(newDate)}`;
}

export function buildSlackJobTimelineStageIdempotencyKey(jobId: string, historyRowId: string) {
  return `slack:job_timeline:${jobId}:stage:${historyRowId}`;
}
