import type { SlackJobSummaryContext } from "@/lib/slack/job-context-loader";

function joinRequiredLabel(context: SlackJobSummaryContext) {
  const parts = [context.requiredDateLabel, context.requiredTimeLabel].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function sectionMarkdown(text: string) {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text,
    },
  };
}

function dividerBlock() {
  return { type: "divider" };
}

function fieldMarkdown(label: string, value: string) {
  return {
    type: "mrkdwn",
    text: `*${label}*\n${value}`,
  };
}

function contextWarningBlock(message: string) {
  return {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `:warning: ${message}`,
      },
    ],
  };
}

function chunkFields(fields: Array<{ type: string; text: string }>) {
  const sections: Array<Record<string, unknown>> = [];

  for (let index = 0; index < fields.length; index += 2) {
    sections.push({
      type: "section",
      fields: fields.slice(index, index + 2),
    });
  }

  return sections;
}

function formatProductionItemsForMarkdown(items: SlackJobSummaryContext["productionItems"]) {
  return items
    .map((item) => {
      if (item.detail) {
        return `• ${item.headline}\n  ${item.detail}`;
      }

      return `• ${item.headline}`;
    })
    .join("\n");
}

function formatProductionItemsForPlainText(items: SlackJobSummaryContext["productionItems"]) {
  return items
    .map((item) => (item.detail ? `• ${item.headline}\n  ${item.detail}` : `• ${item.headline}`))
    .join("\n");
}

export function buildJobSummarySlackMessage(context: SlackJobSummaryContext) {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "JOB ACCEPTED",
        emoji: false,
      },
    },
    sectionMarkdown(`*${context.jobReference}* — ${context.projectName}`),
    dividerBlock(),
  ];

  const required = joinRequiredLabel(context);
  const summaryFields = [fieldMarkdown("Customer", context.companyName)];

  if (context.quoteReference) {
    summaryFields.push(fieldMarkdown("Quote", context.quoteReference));
  }

  if (required) {
    summaryFields.push(fieldMarkdown("Required", required));
  }

  if (context.fulfilmentLabel) {
    summaryFields.push(fieldMarkdown("Fulfilment", context.fulfilmentLabel));
  }

  blocks.push(...chunkFields(summaryFields));

  if (!required) {
    blocks.push(contextWarningBlock("Required date/time missing"));
  }

  if (!context.fulfilmentLabel) {
    blocks.push(contextWarningBlock("Fulfilment details missing"));
  }

  if (context.isDelivery && context.deliveryAddressLines.length > 0) {
    blocks.push(
      sectionMarkdown(`*Delivery*\n${context.deliveryAddressLines.join("\n")}`)
    );
  }

  if (context.siteContactName || context.siteContactPhone) {
    const contactLines = [context.siteContactName, context.siteContactPhone].filter(
      Boolean
    );
    blocks.push(sectionMarkdown(`*Site contact*\n${contactLines.join("\n")}`));
  }

  if (context.purchaseOrderNumber) {
    blocks.push(sectionMarkdown(`*PO*\n${context.purchaseOrderNumber}`));
  }

  if (context.productionItems.length > 0) {
    blocks.push(
      sectionMarkdown(`*Production*\n${formatProductionItemsForMarkdown(context.productionItems)}`)
    );
  }

  if (context.notes) {
    blocks.push(sectionMarkdown(`*Notes*\n${context.notes}`));
  }

  if (context.jobUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Open Job in Candid OS",
            emoji: false,
          },
          url: context.jobUrl,
          action_id: "open_job_in_candid_os",
        },
      ],
    });
  }

  return {
    text: buildPlainTextSummary(context),
    blocks,
  };
}

function buildPlainTextSummary(context: SlackJobSummaryContext) {
  const lines: string[] = ["JOB ACCEPTED", ""];

  lines.push(`${context.jobReference} — ${context.projectName}`, "");

  lines.push(`Customer: ${context.companyName}`);

  if (context.quoteReference) {
    lines.push(`Quote: ${context.quoteReference}`);
  }

  const required = joinRequiredLabel(context);
  if (required) {
    lines.push(`Required: ${required}`);
  } else {
    lines.push("⚠ Required date/time missing");
  }

  if (context.fulfilmentLabel) {
    lines.push(`Fulfilment: ${context.fulfilmentLabel}`);
  } else {
    lines.push("⚠ Fulfilment details missing");
  }

  lines.push("");

  if (context.isDelivery && context.deliveryAddressLines.length > 0) {
    lines.push("Delivery:", ...context.deliveryAddressLines, "");
  }

  if (context.siteContactName || context.siteContactPhone) {
    lines.push("Site contact:");
    if (context.siteContactName) {
      lines.push(context.siteContactName);
    }
    if (context.siteContactPhone) {
      lines.push(context.siteContactPhone);
    }
    lines.push("");
  }

  if (context.purchaseOrderNumber) {
    lines.push(`PO: ${context.purchaseOrderNumber}`, "");
  }

  if (context.productionItems.length > 0) {
    lines.push("Production:");
    lines.push(formatProductionItemsForPlainText(context.productionItems));
    lines.push("");
  }

  if (context.notes) {
    lines.push(`Notes: ${context.notes}`, "");
  }

  if (context.jobUrl) {
    lines.push(`Open Job in Candid OS: ${context.jobUrl}`);
  }

  return lines.join("\n").trim();
}
