import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, it } from "node:test";

import { assertCustomerPortalInviteAllowed } from "@/lib/communications/auth-guards";
import { normalizeContactEmail } from "@/lib/crm/contacts";

const ENV_KEYS = [
  "CANDID_COMMUNICATION_MODE",
  "CANDID_TEST_PORTAL_INVITE_ALLOWLIST",
  "NEXT_PUBLIC_CANDID_TEST_PORTAL_INVITE_ALLOWLIST",
] as const;

type EnvSnapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;

function snapshotEnv(): EnvSnapshot {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as EnvSnapshot;
}

function restoreEnv(snapshot: EnvSnapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

describe("CRM portal invite guard (invite-contact-portal)", () => {
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    process.env.CANDID_COMMUNICATION_MODE = "test";
    process.env.CANDID_TEST_PORTAL_INVITE_ALLOWLIST = "hello@dan-c.co.uk";
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("wires assertCustomerPortalInviteAllowed in invite-contact-portal (not generic auth block)", async () => {
    const source = await readFile(
      new URL("./invite-contact-portal.ts", import.meta.url),
      "utf8"
    );

    assert.match(source, /assertCustomerPortalInviteAllowed/);
    assert.doesNotMatch(source, /getExternalCustomerAuthBlockReason/);
    assert.doesNotMatch(source, /assertCustomerSelfSignupAllowed/);
  });

  it("wires inviteContactToPortal from CRM contact invite API routes", async () => {
    const contactRoute = await readFile(
      new URL("../../app/api/admin/contacts/[id]/invite/route.ts", import.meta.url),
      "utf8"
    );
    const legacyRoute = await readFile(
      new URL("../../app/api/admin/invite-customer/route.ts", import.meta.url),
      "utf8"
    );

    assert.match(contactRoute, /inviteContactToPortal/);
    assert.match(legacyRoute, /inviteContactToPortal/);
  });

  it("blocks the invite guard path used after normalizeContactEmail for non-allowlisted CRM emails", () => {
    const allowlisted = normalizeContactEmail("hello@dan-c.co.uk");
    const typoDomain = normalizeContactEmail("hello@dan-co.uk");

    assert.ok(allowlisted);
    assert.ok(typoDomain);

    const allowed = assertCustomerPortalInviteAllowed(allowlisted);
    const blocked = assertCustomerPortalInviteAllowed(typoDomain);

    assert.equal(allowed.ok, true);
    assert.equal(blocked.ok, false);
    assert.match(
      blocked.ok === false ? blocked.message : "",
      /test communication mode/i
    );
  });

  it("still blocks other external addresses when allowlist is set", () => {
    const guard = assertCustomerPortalInviteAllowed("other@example.com");
    assert.equal(guard.ok, false);
  });
});
