/**
 * Escape dynamic user/content text for Slack mrkdwn (not for button URLs).
 */
export function escapeSlackMrkdwn(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
