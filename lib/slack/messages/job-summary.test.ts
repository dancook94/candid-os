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
    requiredDateLabel: "10 Sep 2026",
    requiredTimeLabel: "10:00",
    fulfilmentLabel: "DELIVERY",
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
    ...overrides,
  };
}

describe("slack job summary message", () => {
  it("renders a delivery job with quote and job numbers that can differ", () => {
    const message = buildJobSummarySlackMessage(buildContext());

    assert.match(message.text, /JOB ACCEPTED/);
    assert.match(message.text, /J-7 — September Dibond Panels/);
    assert.match(message.text, /Customer: Dan C/);
    assert.match(message.text, /Quote: Q-6/);
    assert.match(message.text, /Required: 10 Sep 2026 · 10:00/);
    assert.match(message.text, /Fulfilment: DELIVERY/);
    assert.match(message.text, /Delivery:/);
    assert.match(message.text, /1 × Dibond Panels/);
    assert.match(message.text, /2440 × 1220mm · 3mm Dibond/);

    const blockText = JSON.stringify(message.blocks);
    assert.match(blockText, /\*Quote\*/);
    assert.match(blockText, /Q-6/);
    assert.match(blockText, /J-7/);
    assert.doesNotMatch(blockText, /Not specified/);
  });

  it("shows a warning instead of Not specified when fulfilment is missing", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        fulfilmentLabel: null,
        isDelivery: false,
        isCollection: false,
        deliveryAddressLines: [],
      })
    );

    const blockText = JSON.stringify(message.blocks);
    assert.match(blockText, /Fulfilment details missing/);
    assert.doesNotMatch(blockText, /Not specified/);
  });

  it("omits optional PO when missing", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        purchaseOrderNumber: null,
      })
    );

    assert.doesNotMatch(message.text, /PO:/);
    assert.doesNotMatch(JSON.stringify(message.blocks), /\*PO\*/);
  });

  it("formats required date and time cleanly for UK use", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        requiredDateLabel: "10 Sep 2026",
        requiredTimeLabel: "10:00",
      })
    );

    assert.match(message.text, /Required: 10 Sep 2026 · 10:00/);
  });

  it("warns when required date/time is missing instead of showing an empty block", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        requiredDateLabel: null,
        requiredTimeLabel: null,
      })
    );

    assert.match(message.text, /Required date\/time missing/);
    assert.doesNotMatch(message.text, /Required:\s*$/m);
  });

  it("renders production item dimensions and material on a detail line", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        productionItems: [
          {
            headline: "2 × Foamalite panels",
            detail: "1200 × 800mm · 5mm Foamalite",
          },
        ],
      })
    );

    assert.match(message.text, /2 × Foamalite panels/);
    assert.match(message.text, /1200 × 800mm · 5mm Foamalite/);
  });

  it("renders a collection job without an empty delivery section", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        fulfilmentLabel: "COLLECTION",
        isDelivery: false,
        isCollection: true,
        deliveryAddressLines: [],
        siteContactName: null,
        siteContactPhone: null,
        purchaseOrderNumber: null,
        notes: null,
      })
    );

    assert.match(message.text, /Fulfilment: COLLECTION/);
    assert.doesNotMatch(message.text, /Delivery:/);
    assert.doesNotMatch(message.text, /Site contact:/);
    assert.doesNotMatch(message.text, /PO:/);
    assert.doesNotMatch(message.text, /Notes:/);

    const blockText = JSON.stringify(message.blocks);
    assert.match(blockText, /COLLECTION/);
    assert.doesNotMatch(blockText, /\*Delivery\*/);
  });

  it("omits optional sections when values are missing", () => {
    const message = buildJobSummarySlackMessage(
      buildContext({
        quoteReference: null,
        productionItems: [],
        jobUrl: null,
        notes: null,
      })
    );

    assert.doesNotMatch(message.text, /Quote:/);
    assert.doesNotMatch(message.text, /Production:/);
    assert.doesNotMatch(message.text, /Open Job in Candid OS/);
  });
});
