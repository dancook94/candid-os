import assert from "node:assert/strict";
import test from "node:test";

import { receivePurchaseOrderErrorMessage } from "@/lib/purchasing/receive";

test("receivePurchaseOrderErrorMessage maps over-receive", () => {
  assert.equal(
    receivePurchaseOrderErrorMessage({
      message: "Line abc cannot receive more than was ordered",
    }),
    "A line cannot receive more than was ordered."
  );
});

test("receivePurchaseOrderErrorMessage preserves known validation", () => {
  assert.equal(
    receivePurchaseOrderErrorMessage({ message: "A receipt needs at least one line" }),
    "A receipt needs at least one line."
  );
});
