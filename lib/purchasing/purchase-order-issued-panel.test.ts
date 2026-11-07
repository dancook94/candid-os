import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  purchaseOrderCanSendEmail,
  purchaseOrderEmailRecipientEditable,
} from "@/lib/purchasing/purchase-order-dispatch-ui";
import { purchaseOrderShowsIssuedOperationsPanel } from "@/lib/purchasing/purchase-orders";

function hasOutstandingLines(
  lines: Array<{ quantity: number; receivedQuantity: number }>
) {
  return lines.some((line) => line.receivedQuantity + 0.0001 < line.quantity);
}

describe("purchase order issued operations panel visibility", () => {
  it("shows email and receive sections for issued, partially received, and received orders", () => {
    assert.equal(purchaseOrderShowsIssuedOperationsPanel("issued"), true);
    assert.equal(purchaseOrderShowsIssuedOperationsPanel("partially_received"), true);
    assert.equal(purchaseOrderShowsIssuedOperationsPanel("received"), true);
  });

  it("hides the panel for draft and cancelled orders", () => {
    assert.equal(purchaseOrderShowsIssuedOperationsPanel("draft"), false);
    assert.equal(purchaseOrderShowsIssuedOperationsPanel("cancelled"), false);
    assert.equal(purchaseOrderShowsIssuedOperationsPanel("unknown"), false);
  });

  it("loads issued context from the detail page for every post-issue status", async () => {
    const source = await readFile(
      new URL("../../app/purchasing/[id]/page.tsx", import.meta.url),
      "utf8"
    );
    assert.match(source, /purchaseOrderShowsIssuedOperationsPanel/);
    assert.doesNotMatch(source, /detail\?\.status === "issued"/);
  });
});

describe("purchase order receiving progress", () => {
  it("allows further receipts while quantity remains outstanding", () => {
    assert.equal(
      hasOutstandingLines([{ quantity: 10, receivedQuantity: 4 }]),
      true
    );
    assert.equal(
      hasOutstandingLines([{ quantity: 10, receivedQuantity: 9.9999 }]),
      false
    );
  });

  it("blocks recording when every line is fully received", () => {
    assert.equal(
      hasOutstandingLines([{ quantity: 5, receivedQuantity: 5 }]),
      false
    );
  });

  it("treats mixed lines as receivable when any line still has balance", () => {
    assert.equal(
      hasOutstandingLines([
        { quantity: 2, receivedQuantity: 2 },
        { quantity: 3, receivedQuantity: 1 },
      ]),
      true
    );
  });
});

describe("purchase order supplier email dispatch", () => {
  it("allows the first send when no dispatch row exists", () => {
    assert.equal(purchaseOrderCanSendEmail(null), true);
    assert.equal(purchaseOrderEmailRecipientEditable(null), true);
  });

  it("prevents duplicate sends after a successful delivery", () => {
    const sent = {
      id: "dispatch-1",
      status: "sent",
      attemptCount: 1,
      providerMessageId: "msg-1",
      lastError: null,
      createdAt: "2026-11-01T12:00:00.000Z",
      updatedAt: "2026-11-01T12:00:01.000Z",
    };
    assert.equal(purchaseOrderCanSendEmail(sent), false);
    assert.equal(purchaseOrderEmailRecipientEditable(sent), false);
  });

  it("still blocks duplicate sends when the order is partially or fully received", () => {
    const sent = {
      id: "dispatch-1",
      status: "sent",
      attemptCount: 1,
      providerMessageId: "msg-1",
      lastError: null,
      createdAt: "2026-11-01T12:00:00.000Z",
      updatedAt: "2026-11-01T12:00:01.000Z",
    };
    for (const _status of ["partially_received", "received"] as const) {
      assert.equal(purchaseOrderShowsIssuedOperationsPanel(_status), true);
      assert.equal(purchaseOrderCanSendEmail(sent), false);
    }
  });

  it("allows retry only for queued or failed dispatches", () => {
    const failed = {
      id: "dispatch-2",
      status: "failed",
      attemptCount: 2,
      providerMessageId: null,
      lastError: "Provider timeout",
      createdAt: "2026-11-01T12:00:00.000Z",
      updatedAt: "2026-11-01T12:00:05.000Z",
    };
    assert.equal(purchaseOrderCanSendEmail(failed), true);
    assert.equal(purchaseOrderEmailRecipientEditable(failed), true);
  });
});
