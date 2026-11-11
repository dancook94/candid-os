import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  assertCustomerPortalInviteAllowed,
  assertCustomerPasswordResetAllowed,
  assertCustomerSelfSignupAllowed,
  getExternalCustomerAuthBlockReason,
} from "@/lib/communications/auth-guards";
import {
  getTestPortalInviteAllowlist,
  isCustomerPortalInviteAllowedPublic,
  isTestPortalInviteAllowlisted,
} from "@/lib/communications/portal-invite-allowlist";

const KEYS = [
  "CANDID_COMMUNICATION_MODE",
  "CANDID_PUBLIC_REGISTRATION_ENABLED",
  "CANDID_TEST_PORTAL_INVITE_ALLOWLIST",
  "NEXT_PUBLIC_CANDID_TEST_PORTAL_INVITE_ALLOWLIST",
  "NEXT_PUBLIC_CANDID_COMMUNICATION_MODE",
] as const;

type Snapshot = Record<(typeof KEYS)[number], string | undefined>;

function snapshotEnv(): Snapshot {
  return Object.fromEntries(KEYS.map((key) => [key, process.env[key]])) as Snapshot;
}

function restoreEnv(snapshot: Snapshot) {
  for (const key of KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

describe("test portal invite allowlist", () => {
  let envSnapshot: Snapshot;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    process.env.CANDID_COMMUNICATION_MODE = "test";
    delete process.env.CANDID_PUBLIC_REGISTRATION_ENABLED;
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("allows only allowlisted external emails for portal invites", () => {
    process.env.CANDID_TEST_PORTAL_INVITE_ALLOWLIST = "hello@dan-c.co.uk";

    assert.deepEqual(getTestPortalInviteAllowlist(), ["hello@dan-c.co.uk"]);
    assert.equal(isTestPortalInviteAllowlisted("hello@dan-c.co.uk"), true);
    assert.equal(isTestPortalInviteAllowlisted("other@example.com"), false);

    assert.equal(assertCustomerPortalInviteAllowed("hello@dan-c.co.uk").ok, true);
    assert.equal(assertCustomerPortalInviteAllowed("other@example.com").ok, false);
  });

  it("does not open self-registration or password reset for allowlisted externals", () => {
    process.env.CANDID_PUBLIC_REGISTRATION_ENABLED = "true";
    process.env.CANDID_TEST_PORTAL_INVITE_ALLOWLIST = "hello@dan-c.co.uk";

    assert.equal(getExternalCustomerAuthBlockReason("hello@dan-c.co.uk"), "test_mode_customer_portal_invite_blocked");
    assert.equal(assertCustomerSelfSignupAllowed("hello@dan-c.co.uk").ok, false);
    assert.equal(assertCustomerPasswordResetAllowed("hello@dan-c.co.uk").ok, false);
  });

  it("public helper enables invite UI only for internal or allowlisted addresses in test mode", () => {
    process.env.NEXT_PUBLIC_CANDID_COMMUNICATION_MODE = "test";
    process.env.NEXT_PUBLIC_CANDID_TEST_PORTAL_INVITE_ALLOWLIST = "hello@dan-c.co.uk";

    assert.equal(isCustomerPortalInviteAllowedPublic("hello@dan-c.co.uk"), true);
    assert.equal(isCustomerPortalInviteAllowedPublic("other@example.com"), false);
    assert.equal(isCustomerPortalInviteAllowedPublic("pilot@candidcreative.uk"), true);
  });
});
