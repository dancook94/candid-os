import assert from "node:assert/strict";
import test from "node:test";

import {
  detectInstallationSignals,
  isDeliveryOnlyQuoteLine,
  isInstallationRelatedQuoteLine,
  jobRequiresInstallationProject,
  quoteItemIncludedInAcceptedVersion,
} from "@/lib/installations/detection";

test("delivery-only lines do not qualify as installation", () => {
  assert.equal(isDeliveryOnlyQuoteLine("Delivery to site"), true);
  assert.equal(isInstallationRelatedQuoteLine("Delivery to site"), false);
});

test("delivery and installation combined qualifies", () => {
  assert.equal(isDeliveryOnlyQuoteLine("Delivery and installation"), false);
  assert.equal(isInstallationRelatedQuoteLine("Delivery and installation"), true);
});

test("installation cost component on print line qualifies", () => {
  const signals = detectInstallationSignals(
    [{ id: "a", title: "Window graphics", is_optional: false }],
    [{ quote_item_id: "a", component_type: "installation" }]
  );

  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.fromCostComponent, true);
  assert.equal(jobRequiresInstallationProject(signals), true);
});

test("optional unselected lines are excluded", () => {
  assert.equal(
    quoteItemIncludedInAcceptedVersion({
      id: "x",
      title: "Installation",
      is_optional: true,
      is_selected: false,
    }),
    false
  );

  const signals = detectInstallationSignals(
    [
      {
        id: "x",
        title: "Installation day",
        is_optional: true,
        is_selected: false,
      },
    ],
    []
  );

  assert.equal(signals.length, 0);
});

test("reconcile idempotency signal set is stable", () => {
  const items = [
    { id: "1", title: "Install graphics", is_optional: false },
    { id: "2", title: "Delivery", is_optional: false },
  ];

  const first = detectInstallationSignals(items, []);
  const second = detectInstallationSignals(items, []);

  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
});
