import assert from "node:assert/strict";
import test from "node:test";

import {
  assertInstallationCustomerDenied,
  canManageInstallations,
  canOperateInstallations,
  canReadInstallations,
  isSalesReadOnlyInstallation,
} from "@/lib/installations/permissions";

test("approved production installers can read and operate", () => {
  const profile = { account_status: "approved", user_role: "production" };
  assert.equal(canReadInstallations(profile), true);
  assert.equal(canOperateInstallations(profile), true);
  assert.equal(canManageInstallations(profile), false);
});

test("sales staff have read-only installation access", () => {
  const profile = { account_status: "approved", user_role: "sales" };
  assert.equal(canReadInstallations(profile), true);
  assert.equal(canOperateInstallations(profile), false);
  assert.equal(canManageInstallations(profile), false);
  assert.equal(isSalesReadOnlyInstallation(profile), true);
});

test("accounts staff have no installation visibility in phase 1", () => {
  const profile = { account_status: "approved", user_role: "accounts" };
  assert.equal(canReadInstallations(profile), false);
  assert.equal(canOperateInstallations(profile), false);
});

test("customers are denied", () => {
  assert.equal(assertInstallationCustomerDenied("customer"), true);
  assert.equal(canReadInstallations({ account_status: "approved", user_role: "customer" }), false);
});

test("admins can manage and operate", () => {
  const profile = { account_status: "approved", user_role: "admin" };
  assert.equal(canManageInstallations(profile), true);
  assert.equal(canOperateInstallations(profile), true);
});
