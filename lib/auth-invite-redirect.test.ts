import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildInvitePasswordSetupRedirectForRequest,
  buildRegistrationConfirmRedirectForRequest,
  resolveAuthRedirectOrigin,
} from "@/lib/auth-invite-redirect";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const ENV_KEY = "NEXT_PUBLIC_APP_URL";

describe("resolveAuthRedirectOrigin", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = previous;
    }
  });

  it("uses NEXT_PUBLIC_APP_URL instead of a local request origin on Test", () => {
    process.env[ENV_KEY] = "https://candid-os-test.vercel.app";

    assert.equal(
      resolveAuthRedirectOrigin("http://localhost:3001"),
      "https://candid-os-test.vercel.app"
    );

    const redirect = buildInvitePasswordSetupRedirectForRequest("http://localhost:3001");

    assert.equal(
      redirect,
      "https://candid-os-test.vercel.app/auth/callback?next=/set-password"
    );
    assert.doesNotMatch(redirect, /localhost:3001/);
  });

  it("keeps request origin when no canonical URL is configured", () => {
    delete process.env[ENV_KEY];

    assert.equal(
      resolveAuthRedirectOrigin("http://localhost:3000"),
      "http://localhost:3000"
    );
  });

  it("strips trailing slashes from configured app URL", () => {
    process.env[ENV_KEY] = "https://candid-os-test.vercel.app/";

    assert.equal(
      buildRegistrationConfirmRedirectForRequest("http://localhost:3001"),
      "https://candid-os-test.vercel.app/auth/callback?next=/register/confirmed"
    );
  });
});

describe("auth redirect wiring", () => {
  it("customer and staff invite APIs use canonical redirect helpers", async () => {
    const contactInvite = await readRepoFile(
      "app/api/admin/contacts/[id]/invite/route.ts"
    );
    const staffInvite = await readRepoFile("app/api/admin/invite-staff/route.ts");
    const register = await readRepoFile("app/api/auth/register/route.ts");
    const forgotPassword = await readRepoFile("components/forgot-password-form.tsx");

    assert.match(contactInvite, /buildInvitePasswordSetupRedirectForRequest/);
    assert.doesNotMatch(contactInvite, /buildInvitePasswordSetupRedirect\(requestUrl\.origin\)/);
    assert.match(staffInvite, /buildInvitePasswordSetupRedirectForRequest/);
    assert.match(register, /buildRegistrationConfirmRedirectForRequest/);
    assert.match(forgotPassword, /buildInvitePasswordSetupRedirectForRequest/);
  });

  it("staff resend and password setup routes resolve canonical origin", async () => {
    const resend = await readRepoFile("app/api/admin/staff/[id]/resend-invite/route.ts");
    const passwordSetup = await readRepoFile(
      "app/api/admin/staff/[id]/send-password-setup/route.ts"
    );

    assert.match(resend, /resolveAuthRedirectOrigin/);
    assert.match(passwordSetup, /resolveAuthRedirectOrigin/);
  });
});
