import { escapeSlackMrkdwn } from "@/lib/slack/mrkdwn";

export function formatSlackTimelineDeadlineDate(dateString: string | null | undefined) {
  if (!dateString?.trim()) {
    return "Not set";
  }

  return new Date(`${dateString.trim()}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatSlackTimelineTimestamp(date: Date = new Date()) {
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildActorContextLine(actorName: string | null | undefined, at: Date = new Date()) {
  const time = formatSlackTimelineTimestamp(at);

  if (actorName?.trim()) {
    return `Updated by ${escapeSlackMrkdwn(actorName.trim())} · ${time}`;
  }

  return time;
}

function timelineSection(titleLine: string, bodyLines: string[], contextLine: string) {
  const body = bodyLines.map((line) => escapeSlackMrkdwn(line)).join("\n");
  const text = `${titleLine}\n${body}\n${contextLine}`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${escapeSlackMrkdwn(titleLine)}*\n${body}\n_${escapeSlackMrkdwn(contextLine)}_`,
        },
      },
    ],
  };
}

export function buildProductionDeadlineSetTimelineMessage(input: {
  newDate: string;
  actorName?: string | null;
  at?: Date;
}) {
  const formatted = formatSlackTimelineDeadlineDate(input.newDate);
  return timelineSection(
    "🕒 Production deadline set",
    [formatted],
    buildActorContextLine(input.actorName, input.at)
  );
}

export function buildProductionDeadlineChangedTimelineMessage(input: {
  oldDate: string;
  newDate: string;
  actorName?: string | null;
  at?: Date;
}) {
  const from = formatSlackTimelineDeadlineDate(input.oldDate);
  const to = formatSlackTimelineDeadlineDate(input.newDate);

  return timelineSection(
    "🕒 Production deadline updated",
    [`${from} → ${to}`],
    buildActorContextLine(input.actorName, input.at)
  );
}

export function buildProductionDeadlineClearedTimelineMessage(input: {
  oldDate: string;
  actorName?: string | null;
  at?: Date;
}) {
  const previous = formatSlackTimelineDeadlineDate(input.oldDate);

  return timelineSection(
    "🕒 Production deadline cleared",
    [`Previously ${previous}`],
    buildActorContextLine(input.actorName, input.at)
  );
}

export function buildProductionStageChangedTimelineMessage(input: {
  previousLabel: string;
  newLabel: string;
  actorName?: string | null;
  at?: Date;
}) {
  return timelineSection(
    "🏭 Production stage changed",
    [`${input.previousLabel} → ${input.newLabel}`],
    buildActorContextLine(input.actorName, input.at)
  );
}

export function resolveDeadlineTimelineMessage(input: {
  oldDate: string | null;
  newDate: string | null;
  actorName?: string | null;
  at?: Date;
}) {
  const oldDate = input.oldDate?.trim() || null;
  const newDate = input.newDate?.trim() || null;

  if (oldDate === newDate) {
    return null;
  }

  if (!oldDate && newDate) {
    return buildProductionDeadlineSetTimelineMessage({
      newDate,
      actorName: input.actorName,
      at: input.at,
    });
  }

  if (oldDate && newDate) {
    return buildProductionDeadlineChangedTimelineMessage({
      oldDate,
      newDate,
      actorName: input.actorName,
      at: input.at,
    });
  }

  if (oldDate && !newDate) {
    return buildProductionDeadlineClearedTimelineMessage({
      oldDate,
      actorName: input.actorName,
      at: input.at,
    });
  }

  return null;
}
