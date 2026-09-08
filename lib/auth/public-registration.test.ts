import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertCustomerSelfSignupAllowed } from "@/lib/communications/auth-guards";
import {
  assertPublicRegistrationEnabled,
  isPublicRegistrationEnabled,
} from "@/lib/auth/public-registration";
import { POST as registerPost } from "@/app/api/auth/register/route";

const ENV_KEY = "CANDID_PUBLIC_REGISTRATION_ENABLED";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

function snapshotEnv() {
  return process.env[ENV_KEY];
}

function restoreEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
}

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

describe("public registration config", () => {
  let envSnapshot: string | undefined;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("1. registration env missing defaults to disabled", () => {
    delete process.env[ENV_KEY];

    assert.equal(isPublicRegistrationEnabled(), false);
    assert.equal(assertPublicRegistrationEnabled().ok, false);
  });

  it("2. registration=false disables registration", () => {
    process.env[ENV_KEY] = "false";

    assert.equal(isPublicRegistrationEnabled(), false);
    assert.equal(assertPublicRegistrationEnabled().ok, false);
  });

  it("3. registration=true enables registration", () => {
    process.env[ENV_KEY] = "true";

    assert.equal(isPublicRegistrationEnabled(), true);
    assert.equal(assertPublicRegistrationEnabled().ok, true);
  });

  it("invalid registration env values default to disabled", () => {
    for (const value of ["1", "yes", "enabled", ""]) {
      process.env[ENV_KEY] = value;
      assert.equal(isPublicRegistrationEnabled(), false, `expected false for ${value}`);
    }
  });
});

describe("public registration server enforcement", () => {
  let envSnapshot: string | undefined;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("4. direct signup route cannot bypass disabled state", async () => {
    delete process.env[ENV_KEY];

    const response = await registerPost(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "Test User",
          companyName: "Test Co",
          email: "test@customer.com",
          password: "password123",
        }),
      })
    );

    assert.equal(response.status, 403);

    const payload = (await response.json()) as { error?: string };
    assert.match(payload.error ?? "", /currently unavailable/i);
  });

  it("signup guard rejects when registration is disabled", () => {
    delete process.env[ENV_KEY];

    const guard = assertCustomerSelfSignupAllowed("test@customer.com");

    assert.equal(guard.ok, false);
    if (!guard.ok) {
      assert.equal(guard.reason, "public_registration_disabled");
    }
  });

  it("register page uses server-side availability check", async () => {
    const pageSource = await readRepoFile("app/register/page.tsx");

    assert.match(pageSource, /isPublicRegistrationEnabled/);
    assert.match(pageSource, /RegisterUnavailable/);
    assert.doesNotMatch(pageSource, /supabase\.auth\.signUp/);
  });

  it("register form submits through server register API", async () => {
    const formSource = await readRepoFile("components/register-form.tsx");

    assert.match(formSource, /\/api\/auth\/register/);
    assert.doesNotMatch(formSource, /supabase\.auth\.signUp/);
  });
});

describe("staff login and session behaviour", () => {
  it("5. existing staff login flow is unchanged", async () => {
    const loginFormSource = await readRepoFile("app/login/login-form.tsx");
    const middlewareSource = await readRepoFile("lib/supabase/middleware.ts");

    assert.match(loginFormSource, /signInWithPassword/);
    assert.doesNotMatch(loginFormSource, /CANDID_PUBLIC_REGISTRATION_ENABLED/);
    assert.match(middlewareSource, /\/login/);
    assert.match(middlewareSource, /getUser/);
  });

  it("6. authenticated sessions continue to refresh through middleware", async () => {
    const middlewareSource = await readRepoFile("middleware.ts");
    const sessionSource = await readRepoFile("lib/supabase/middleware.ts");

    assert.match(middlewareSource, /updateSession/);
    assert.match(sessionSource, /await supabase\.auth\.getUser\(\)/);
    assert.doesNotMatch(sessionSource, /CANDID_PUBLIC_REGISTRATION_ENABLED/);
  });
});

describe("admin staff creation behaviour", () => {
  it("7. staff invitation uses a separate super-admin API route", async () => {
    const staffInviteSource = await readRepoFile("app/api/admin/invite-staff/route.ts");
    const registerRouteSource = await readRepoFile("app/api/auth/register/route.ts");

    assert.match(staffInviteSource, /verifySuperAdmin/);
    assert.match(staffInviteSource, /inviteUserByEmail/);
    assert.doesNotMatch(staffInviteSource, /isPublicRegistrationEnabled/);
    assert.match(registerRouteSource, /assertPublicRegistrationEnabled/);
  });
});
