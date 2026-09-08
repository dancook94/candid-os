import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildInvitePasswordSetupRedirect } from "@/lib/auth-invite-redirect";
import {
  canResendStaffInvite,
  canSendStaffPasswordSetup,
  mapStaffAuthActionError,
  mapStaffAuthState,
  resolveStaffAuthActionType,
} from "@/lib/staff-auth-actions";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

describe("staff auth action eligibility", () => {
  it("4. unconfirmed invited staff use resend invite", () => {
    const auth = {
      invited_at: "2026-09-08T10:00:00Z",
      email_confirmed_at: null,
      confirmed_at: null,
      last_sign_in_at: null,
    };

    assert.equal(canResendStaffInvite(auth), true);
    assert.equal(canSendStaffPasswordSetup(auth), false);
    assert.equal(resolveStaffAuthActionType(auth), "resend_invite");
  });

  it("5. confirmed staff use password setup path", () => {
    const auth = {
      invited_at: "2026-09-08T10:00:00Z",
      email_confirmed_at: "2026-09-08T10:05:00Z",
      confirmed_at: "2026-09-08T10:05:00Z",
      last_sign_in_at: "2026-09-08T10:05:00Z",
    };

    assert.equal(canResendStaffInvite(auth), false);
    assert.equal(canSendStaffPasswordSetup(auth), true);
    assert.equal(resolveStaffAuthActionType(auth), "send_password_setup");
  });

  it("10. confirmed staff are not labelled setup incomplete", async () => {
    const tableSource = await readRepoFile("components/staff-management-table.tsx");
    const editFormSource = await readRepoFile("components/edit-staff-form.tsx");

    assert.doesNotMatch(tableSource, /setup incomplete/i);
    assert.doesNotMatch(editFormSource, /setup incomplete/i);
  });

  it("confirmed staff with sign-in still get password setup action only", () => {
    const beaAuth = {
      invited_at: "2026-09-08T10:51:33Z",
      email_confirmed_at: "2026-09-08T10:53:24Z",
      confirmed_at: "2026-09-08T10:53:24Z",
      last_sign_in_at: "2026-09-08T10:53:24Z",
    };

    assert.equal(resolveStaffAuthActionType(beaAuth), "send_password_setup");
  });
});

describe("staff auth action redirect and errors", () => {
  it("6. uses /auth/callback?next=/set-password redirect helper", () => {
    const redirectTo = buildInvitePasswordSetupRedirect("https://candid-os-one.vercel.app");

    assert.equal(
      redirectTo,
      "https://candid-os-one.vercel.app/auth/callback?next=/set-password"
    );
  });

  it("8. maps Supabase rate-limit failures to safe errors", () => {
    const mapped = mapStaffAuthActionError({
      message: "Email rate limit exceeded",
      status: 429,
    });

    assert.equal(mapped.status, 429);
    assert.match(mapped.message, /too many requests/i);
  });

  it("maps already registered errors to actionable guidance", () => {
    const mapped = mapStaffAuthActionError({
      message: "A user with this email address has already been registered",
    });

    assert.match(mapped.message, /send password setup link/i);
  });
});

describe("staff auth action route security", () => {
  it("1. resend invite route requires super_admin", async () => {
    const source = await readRepoFile(
      "app/api/admin/staff/[id]/resend-invite/route.ts"
    );

    assert.match(source, /verifySuperAdmin/);
  });

  it("1. password setup route requires super_admin", async () => {
    const source = await readRepoFile(
      "app/api/admin/staff/[id]/send-password-setup/route.ts"
    );

    assert.match(source, /verifySuperAdmin/);
  });

  it("2. customer profiles are rejected in shared staff auth actions", async () => {
    const source = await readRepoFile("lib/staff-auth-actions.ts");

    assert.match(source, /isStaffRole/);
    assert.match(source, /This profile is not a staff account/);
  });

  it("3. resend invite does not upsert or mutate profile role/status", async () => {
    const source = await readRepoFile("lib/staff-auth-actions.ts");

    assert.doesNotMatch(source, /\.upsert\(/);
    assert.doesNotMatch(source, /\.update\(/);
    assert.doesNotMatch(source, /deleteUser/);
    assert.doesNotMatch(source, /createUser/);
  });

  it("5. confirmed staff recovery uses resetPasswordForEmail server-side", async () => {
    const source = await readRepoFile("lib/staff-auth-actions.ts");

    assert.match(source, /resetPasswordForEmail/);
    assert.match(source, /buildInvitePasswordSetupRedirect/);
  });

  it("4. unconfirmed staff resend uses inviteUserByEmail", async () => {
    const source = await readRepoFile("lib/staff-auth-actions.ts");

    assert.match(source, /inviteUserByEmail/);
  });

  it("7. routes do not return raw tokens to the client", async () => {
    const resendRoute = await readRepoFile(
      "app/api/admin/staff/[id]/resend-invite/route.ts"
    );
    const setupRoute = await readRepoFile(
      "app/api/admin/staff/[id]/send-password-setup/route.ts"
    );

    assert.doesNotMatch(resendRoute, /token_hash|hashed_token|action_link/);
    assert.doesNotMatch(setupRoute, /token_hash|hashed_token|action_link/);
  });
});

describe("staff listing auth fields", () => {
  it("9. staff members expose safe auth-state fields", async () => {
    const source = await readRepoFile("lib/staff-members.ts");

    assert.match(source, /invited_at/);
    assert.match(source, /email_confirmed_at/);
    assert.match(source, /confirmed_at/);
    assert.match(source, /last_sign_in_at/);
    assert.doesNotMatch(source, /hashed_token|service_role|password/);
  });

  it("mapStaffAuthState copies safe auth metadata only", () => {
    const mapped = mapStaffAuthState({
      id: "staff-1",
      aud: "authenticated",
      role: "authenticated",
      email: "staff@candidcreative.uk",
      invited_at: "2026-09-08T10:00:00Z",
      email_confirmed_at: null,
      confirmed_at: null,
      last_sign_in_at: null,
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-09-08T10:00:00Z",
    });

    assert.deepEqual(mapped, {
      invited_at: "2026-09-08T10:00:00Z",
      email_confirmed_at: null,
      confirmed_at: null,
      last_sign_in_at: null,
    });
  });
});

describe("staff auth communication safety", () => {
  it("staff auth actions do not use customer Resend notifications", async () => {
    const source = await readRepoFile("lib/staff-auth-actions.ts");

    assert.doesNotMatch(source, /sendNotification|resend-client|applyCommunicationSafety/);
    assert.doesNotMatch(source, /assertCustomerPortalInviteAllowed/);
  });
});

describe("existing auth safety regressions", () => {
  it("11. auth callback still supports invite and recovery OTP types", async () => {
    const callbackSource = await readRepoFile("app/auth/callback/route.ts");
    const redirectSource = await readRepoFile("lib/auth-invite-redirect.ts");

    assert.match(callbackSource, /token_hash/);
    assert.match(callbackSource, /verifyOtp/);
    assert.match(redirectSource, /"invite"/);
    assert.match(redirectSource, /"recovery"/);
  });

  it("12. registration safety tests remain present", async () => {
    const source = await readRepoFile("lib/auth/public-registration.test.ts");

    assert.match(source, /public registration config/);
    assert.match(source, /registration env missing defaults to disabled/);
  });

  it("13. communication safety tests remain present", async () => {
    const source = await readRepoFile("lib/communications/communication-safety.test.ts");

    assert.match(source, /communication safety/);
  });
});
