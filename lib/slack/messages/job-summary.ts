import type { SlackJobSummaryContext } from "@/lib/slack/job-context-loader";
import { escapeSlackMrkdwn } from "@/lib/slack/mrkdwn";

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
    text: `*${escapeSlackMrkdwn(label)}*\n${escapeSlackMrkdwn(value)}`,
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
      const headline = escapeSlackMrkdwn(item.headline);
      if (item.detail) {
        return `• ${headline}\n  ${escapeSlackMrkdwn(item.detail)}`;
      }

      return `• ${headline}`;
    })
    .join("\n");
}

function formatProductionItemsForPlainText(items: SlackJobSummaryContext["productionItems"]) {
  return items
    .map((item) => (item.detail ? `• ${item.headline}\n  ${item.detail}` : `• ${item.headline}`))
    .join("\n");
}

function buildHeaderText(context: SlackJobSummaryContext) {
  return `${context.jobReference} · ${context.companyName}`;
}

export function buildJobSummarySlackMessage(context: SlackJobSummaryContext) {
  const headerText = buildHeaderText(context);

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: headerText.slice(0, 150),
        emoji: false,
      },
    },
    dividerBlock(),
  ];

  const summaryFields = [
    fieldMarkdown("Project", context.projectName),
    fieldMarkdown("Customer", context.companyName),
    fieldMarkdown("Production deadline", context.productionDeadlineLabel),
    ...(context.fulfilmentLabel
      ? [fieldMarkdown("Fulfilment", context.fulfilmentLabel)]
      : []),
    ...(context.quoteReference
      ? [fieldMarkdown("Quote", context.quoteReference)]
      : []),
    fieldMarkdown("Artwork", context.artworkLabel),
    fieldMarkdown("Proof", context.proofLabel),
    fieldMarkdown("Production", context.productionStageLabel),
  ];

  blocks.push(...chunkFields(summaryFields));

  if (context.isDelivery && context.deliveryAddressLines.length > 0) {
    blocks.push(
      sectionMarkdown(
        `*Delivery*\n${context.deliveryAddressLines.map((line) => escapeSlackMrkdwn(line)).join("\n")}`
      )
    );
  }

  if (context.siteContactName || context.siteContactPhone) {
    const contactLines = [context.siteContactName, context.siteContactPhone].filter(
      Boolean
    ) as string[];
    blocks.push(
      sectionMarkdown(
        `*Site contact*\n${contactLines.map((line) => escapeSlackMrkdwn(line)).join("\n")}`
      )
    );
  }

  if (context.purchaseOrderNumber) {
    blocks.push(sectionMarkdown(`*PO*\n${escapeSlackMrkdwn(context.purchaseOrderNumber)}`));
  }

  if (context.productionItems.length > 0) {
    blocks.push(
      sectionMarkdown(`*Production*\n${formatProductionItemsForMarkdown(context.productionItems)}`)
    );
  }

  if (context.notes) {
    blocks.push(sectionMarkdown(`*Notes*\n${escapeSlackMrkdwn(context.notes)}`));
  }

  const actionElements: Array<Record<string, unknown>> = [];

  if (context.jobUrl) {
    actionElements.push({
      type: "button",
      text: {
        type: "plain_text",
        text: "Open Job in Candid OS",
        emoji: false,
      },
      url: context.jobUrl,
      action_id: "open_job_in_candid_os",
    });
  }

  if (context.quoteUrl) {
    actionElements.push({
      type: "button",
      text: {
        type: "plain_text",
        text: "View Quote",
        emoji: false,
      },
      url: context.quoteUrl,
      action_id: "open_quote_in_candid_os",
    });
  }

  if (context.dropboxWebUrl) {
    actionElements.push({
      type: "button",
      text: {
        type: "plain_text",
        text: "Dropbox",
        emoji: false,
      },
      url: context.dropboxWebUrl,
      action_id: "open_dropbox_folder",
    });
  }

  if (actionElements.length > 0) {
    blocks.push({
      type: "actions",
      elements: actionElements,
    });
  }

  return {
    text: buildPlainTextSummary(context),
    blocks,
  };
}

function buildPlainTextSummary(context: SlackJobSummaryContext) {
  const lines: string[] = [buildHeaderText(context), ""];

  lines.push(`Project: ${context.projectName}`);
  lines.push(`Customer: ${context.companyName}`);
  lines.push(`Production deadline: ${context.productionDeadlineLabel}`);

  if (context.fulfilmentLabel) {
    lines.push(`Fulfilment: ${context.fulfilmentLabel}`);
  }

  if (context.quoteReference) {
    lines.push(`Quote: ${context.quoteReference}`);
  }

  lines.push(`Artwork: ${context.artworkLabel}`);
  lines.push(`Proof: ${context.proofLabel}`);
  lines.push(`Production: ${context.productionStageLabel}`);
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

  if (context.quoteUrl) {
    lines.push(`View Quote: ${context.quoteUrl}`);
  }

  if (context.dropboxWebUrl) {
    lines.push(`Dropbox: ${context.dropboxWebUrl}`);
  }

  return lines.join("\n").trim();
}
