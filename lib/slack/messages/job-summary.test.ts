import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SlackJobSummaryContext } from "@/lib/slack/job-context-loader";
import { buildJobSummarySlackMessage } from "@/lib/slack/messages/job-summary";

function buildContext(
  overrides: Partial<SlackJobSummaryContext> = {}
): SlackJobSummaryContext {
  return {
    jobId: "job-1",
    jobReference: "J-7",
    projectName: "September Dibond Panels",
    companyName: "Dan C",
    quoteReference: "Q-6",
    ownerName: null,
    requiredDateLabel: "2026-09-10",
    requiredTimeLabel: "10:00",
    productionDeadlineLabel: "Wed 10 Sep · 10:00",
    artworkLabel: "Awaiting artwork",
    proofLabel: "Required",
    productionStageLabel: "Accepted Quotes",
    fulfilmentLabel: "Delivery",
    isDelivery: true,
    isCollection: false,
    deliveryAddressLines: [
      "ExCeL London",
      "Royal Victoria Dock",
      "London",
      "E16 1XL",
    ],
    siteContactName: "John Smith",
    siteContactPhone: "07123456789",
    purchaseOrderNumber: "PO12345",
    productionItems: [
      {
        headline: "1 × Dibond Panels",
        detail: "2440 × 1220mm · 3mm Dibond",
      },
    ],
    notes: "Deliver to loading bay B.",
    jobUrl: "https://app.example.com/admin/jobs/job-1",
    quoteUrl: "https://app.example.com/admin/quotes/quote-6",
    dropboxWebUrl: null,
    ...overrides,
  };
}

describe("slack job summary message", () => {
  it("uses job reference and company in the header", () => {
    const message = buildJobSummarySlackMessage(buildContext());

    assert.match(message.text, /J-7 · Dan C/);
    assert.doesNotMatch(message.text, /JOB ACCEPTED/);

    const blockText = JSON.stringify(message.blocks);
    assert.match(blockText, /J-7 · Dan C/);
    assert.doesNotMatch(blockText, /J-7 — September/);
  });

  it("includes project, customer, deadline, fulfilment, quote, artwork, proof and production fields", () => {
    const message = buildJobSummarySlackMessage(buildContext());
    const blockText = JSON.stringify(message.blocks);

    assert.match(message.text, /Project: September Dibond Panels/);
    assert.match(message.text, /Customer: Dan C/);
    assert.match(message.text, /Production deadline:/);
    assert.match(message.text, /Fulfilment: Delivery/);
    assert.match(message.text, /Quote: Q-6/);
    assert.match(message.text, /Artwork: Awaiting artwork/);
    assert.match(message.text, /Proof: Required/);
    assert.match(message.text, /Production: Accepted Quotes/);

    assert.match(blockText, /\*Production deadline\*/);
    assert.match(blockText, /\*Artwork\*/);
    assert.match(blockText, /\*Proof\*/);
    assert.match(blockText, /\*Production\*/);
  });

  it("shows Not set when no production deadline exists", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        productionDeadlineLabel: "Not set",
        requiredDateLabel: null,
        requiredTimeLabel: null,
      })
    );

    assert.match(message.text, /Production deadline: Not set/);
    assert.doesNotMatch(JSON.stringify(message.blocks), /missing/);
  });

  it("preserves delivery, site contact, PO, notes and production items", () => {
    const message = buildJobSummarySlackMessage(buildContext());

    assert.match(message.text, /Delivery:/);
    assert.match(message.text, /ExCeL London/);
    assert.match(message.text, /Site contact:/);
    assert.match(message.text, /PO: PO12345/);
    assert.match(message.text, /Notes: Deliver to loading bay B./);
    assert.match(message.text, /1 × Dibond Panels/);
    assert.match(message.text, /2440 × 1220mm · 3mm Dibond/);
  });

  it("includes Candid OS and quote action buttons when URLs exist", () => {
    const message = buildJobSummarySlackMessage(buildContext());
    const blockText = JSON.stringify(message.blocks);

    assert.match(blockText, /Open Job in Candid OS/);
    assert.match(blockText, /View Quote/);
    assert.match(blockText, /admin\/jobs\/job-1/);
    assert.match(blockText, /admin\/quotes\/quote-6/);
  });

  it("does not add a Dropbox button when only a folder path would be available", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        dropboxWebUrl: null,
      })
    );

    assert.doesNotMatch(JSON.stringify(message.blocks), /Dropbox/);
  });

  it("adds a Dropbox button only for genuine web URLs", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        dropboxWebUrl: "https://www.dropbox.com/home/Candid/J-7",
      })
    );

    assert.match(JSON.stringify(message.blocks), /"text":"Dropbox"/);
  });

  it("renders a collection job without an empty delivery section", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        fulfilmentLabel: "Collection",
        isDelivery: false,
        isCollection: true,
        deliveryAddressLines: [],
        siteContactName: null,
        siteContactPhone: null,
        purchaseOrderNumber: null,
        notes: null,
      })
    );

    assert.match(message.text, /Fulfilment: Collection/);
    assert.doesNotMatch(message.text, /Delivery:/);
  });

  it("omits optional quote button and sections when missing", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        quoteReference: null,
        quoteUrl: null,
        productionItems: [],
        jobUrl: null,
        notes: null,
      })
    );

    assert.doesNotMatch(message.text, /Quote:/);
    assert.doesNotMatch(JSON.stringify(message.blocks), /View Quote/);
    assert.doesNotMatch(message.text, /Open Job in Candid OS/);
  });

  it("escapes dynamic mrkdwn in notes", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        notes: "Check A & B <urgent>",
      })
    );

    assert.match(JSON.stringify(message.blocks), /A &amp; B &lt;urgent&gt;/);
  });
});
