import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptanceBlockedMessage,
  compatibilityWorkClass,
  effectiveWorkClass,
  effectiveWorkRequirements,
  installationReconcileIsRetryable,
  lineIsIncludedInAcceptance,
  normalizeWorkRequirements,
  quoteRequiresInstallation,
  suggestWorkClass,
  suggestWorkRequirements,
  unclassifiedIncludedLineTitles,
} from "@/lib/installations/classification";

test("cost components suggest a class and titles do not", () => {
  assert.equal(suggestWorkClass([]), null);
  assert.equal(suggestWorkClass(["printing"]), "print_supply");
  assert.equal(suggestWorkClass(["delivery"]), "delivery");
  assert.equal(suggestWorkClass(["printing", "delivery"]), "print_supply");
  assert.equal(suggestWorkClass(["installation"]), "installation");
  assert.equal(suggestWorkClass(["printing", "installation", "delivery"]), "installation");
  assert.equal(
    suggestWorkClass(["delivery"]),
    "delivery"
  );
});

test("staff override survives a later costing suggestion", () => {
  assert.equal(
    effectiveWorkClass({
      overridden: true,
      current: "delivery",
      componentTypes: ["installation", "printing"],
    }),
    "delivery"
  );
  assert.equal(
    effectiveWorkClass({
      overridden: false,
      current: "delivery",
      componentTypes: ["installation"],
    }),
    "installation"
  );
});

test("selected optional lines are included and unselected optional lines are not", () => {
  assert.equal(lineIsIncludedInAcceptance({ isOptional: false, isSelected: false }), true);
  assert.equal(lineIsIncludedInAcceptance({ isOptional: true, isSelected: true }), true);
  assert.equal(lineIsIncludedInAcceptance({ isOptional: true, isSelected: false }), false);
  assert.equal(lineIsIncludedInAcceptance({ isOptional: true, isSelected: null }), false);
});

test("installation, print-only, delivery-only and mixed quotes", () => {
  assert.equal(
    quoteRequiresInstallation([
      { isOptional: false, isSelected: true, workClass: "installation" },
    ]),
    true
  );
  assert.equal(
    quoteRequiresInstallation([
      { isOptional: false, isSelected: true, workClass: "print_supply" },
    ]),
    false
  );
  assert.equal(
    quoteRequiresInstallation([
      { isOptional: false, isSelected: true, workClass: "delivery" },
    ]),
    false
  );
  assert.equal(
    quoteRequiresInstallation([
      { isOptional: false, isSelected: true, workClass: "print_supply" },
      { isOptional: false, isSelected: true, workClass: "installation" },
    ]),
    true
  );
  assert.equal(
    quoteRequiresInstallation([
      { isOptional: true, isSelected: false, workClass: "installation" },
      { isOptional: false, isSelected: true, workClass: "print_supply" },
    ]),
    false
  );
});

test("historical null lines do not qualify and block a new acceptance until classified", () => {
  const historical = [
    {
      title: "Site installation",
      isOptional: false,
      isSelected: true,
      workClass: null,
    },
  ];

  assert.equal(quoteRequiresInstallation(historical), false);
  assert.deepEqual(unclassifiedIncludedLineTitles(historical), ["Site installation"]);
  assert.match(
    acceptanceBlockedMessage(unclassifiedIncludedLineTitles(historical)) ?? "",
    /Site installation/
  );
  assert.deepEqual(
    unclassifiedIncludedLineTitles([
      {
        title: "Optional install",
        isOptional: true,
        isSelected: false,
        workClass: null,
      },
      {
        title: "Brochures",
        isOptional: false,
        isSelected: true,
        workClass: "print_supply",
      },
    ]),
    []
  );
});

test("a line can require any combination and staff overrides stay put", () => {
  assert.deepEqual(suggestWorkRequirements(["printing", "delivery", "installation"]), {
    printSupply: true,
    delivery: true,
    installation: true,
  });
  assert.deepEqual(suggestWorkRequirements(["materials"]), {
    printSupply: false,
    delivery: false,
    installation: false,
  });
  assert.deepEqual(
    effectiveWorkRequirements({
      overridden: true,
      current: { printSupply: true, delivery: true, installation: false },
      componentTypes: ["installation"],
    }),
    { printSupply: true, delivery: true, installation: false }
  );
  assert.deepEqual(
    normalizeWorkRequirements({ workClass: "delivery" }),
    { printSupply: false, delivery: true, installation: false }
  );
  assert.equal(
    compatibilityWorkClass({ printSupply: true, delivery: true, installation: true }),
    "installation"
  );
  assert.equal(
    compatibilityWorkClass({ printSupply: true, delivery: true, installation: false }),
    null
  );

  const mixed = {
    isOptional: false,
    isSelected: true,
    requirements: { printSupply: true, delivery: true, installation: false },
  };
  assert.equal(quoteRequiresInstallation([mixed]), false);
  assert.deepEqual(
    unclassifiedIncludedLineTitles([{ title: "Signs", ...mixed }]),
    []
  );
  assert.equal(
    quoteRequiresInstallation([
      {
        isOptional: false,
        isSelected: true,
        requirements: { printSupply: true, delivery: false, installation: true },
      },
    ]),
    true
  );
  assert.equal(
    quoteRequiresInstallation([
      {
        isOptional: true,
        isSelected: false,
        requirements: { printSupply: false, delivery: false, installation: true },
      },
    ]),
    false
  );
});

test("only a failed phase 2 reconcile is retryable", () => {
  assert.equal(
    installationReconcileIsRetryable({ autoReconcile: true, status: "failed" }),
    true
  );
  assert.equal(
    installationReconcileIsRetryable({ autoReconcile: false, status: "failed" }),
    false
  );
  assert.equal(
    installationReconcileIsRetryable({ autoReconcile: true, status: "succeeded" }),
    false
  );
});
