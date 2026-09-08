export const SLACK_JOB_CHANNEL_NOTIFICATION_TYPE = "slack_job_channel_created";

export function buildSlackJobChannelIdempotencyKey(jobId: string) {
  return `slack:job_channel_created:${jobId}`;
}
