import assert from "node:assert/strict";
import test from "node:test";

import {
  purchaseOrderCanSendEmail,
  purchaseOrderEmailRecipientEditable,
} from "@/lib/purchasing/purchase-order-dispatch-ui";

const dispatch = {
  id: "d1",
  status: "queued",
  attemptCount: 0,
  providerMessageId: null,
  lastError: null,
  createdAt: "",
  updatedAt: "",
};

test("purchaseOrderCanSendEmail blocks sent and in-flight dispatches", () => {
  assert.equal(purchaseOrderCanSendEmail(null), true);
  assert.equal(purchaseOrderCanSendEmail({ ...dispatch, status: "sent" }), false);
  assert.equal(purchaseOrderCanSendEmail({ ...dispatch, status: "sending" }), false);
  assert.equal(purchaseOrderCanSendEmail({ ...dispatch, status: "unknown" }), false);
  assert.equal(purchaseOrderCanSendEmail({ ...dispatch, status: "failed" }), true);
  assert.equal(purchaseOrderCanSendEmail({ ...dispatch, status: "queued" }), true);
});

test("purchaseOrderEmailRecipientEditable locks after successful send", () => {
  assert.equal(purchaseOrderEmailRecipientEditable(null), true);
  assert.equal(purchaseOrderEmailRecipientEditable({ ...dispatch, status: "sent" }), false);
  assert.equal(purchaseOrderEmailRecipientEditable({ ...dispatch, status: "failed" }), true);
});
