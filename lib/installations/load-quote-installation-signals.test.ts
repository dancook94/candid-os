import assert from "node:assert/strict";
import test from "node:test";

import { detectInstallationSignals } from "@/lib/installations/detection";

test("installation component resolution follows quote_item_costs bridge", () => {
  const items = [
    { id: "item-1", title: "Window vinyl", is_optional: false },
    { id: "item-2", title: "Delivery only", is_optional: false },
  ];

  const signals = detectInstallationSignals(items, [
    { quote_item_id: "item-1", component_type: "installation" },
  ]);

  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.quoteItemId, "item-1");
  assert.equal(signals[0]?.fromCostComponent, true);
  assert.equal(signals[0]?.fromSellLine, false);
});
