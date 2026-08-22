export function logNotificationStage(
  stage: string,
  details: Record<string, unknown>
) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info(`[notifications:${stage}]`, details);
}
