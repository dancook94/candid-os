import "server-only";

import { getSlackConfig } from "@/lib/slack/config";
import { SlackError } from "@/lib/slack/errors";

type SlackApiResponse<T> = {
  ok: boolean;
  error?: string;
} & T;

export async function slackApi<T>(
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const config = getSlackConfig();

  if (!config.botToken) {
    throw new SlackError(
      "Slack is not configured. Missing SLACK_BOT_TOKEN.",
      "not_configured",
      503
    );
  }

  const payload = new URLSearchParams();

  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) {
      continue;
    }

    payload.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  let response: Response;

  try {
    response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.botToken}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: payload.toString(),
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Slack API request failed.";

    throw new SlackError(message, "unreachable", 502);
  }

  const json = (await response.json()) as SlackApiResponse<T>;

  if (!response.ok) {
    throw new SlackError(
      `Slack HTTP ${response.status}.`,
      "http_error",
      response.status,
      json.error
    );
  }

  if (!json.ok) {
    throw new SlackError(
      json.error ? `Slack API error: ${json.error}` : "Slack API request failed.",
      "api_error",
      502,
      json.error
    );
  }

  return json;
}
