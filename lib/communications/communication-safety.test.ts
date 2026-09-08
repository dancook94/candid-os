import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyCommunicationSafety } from "@/lib/communications/safety";
import { getCommunicationConfig } from "@/lib/communications/config";

const ENV_KEYS = [
  "CANDID_COMMUNICATION_MODE",
  "CANDID_TEST_EMAIL_RECIPIENT",
  "EMAIL_MODE",
  "EMAIL_TEST_RECIPIENT",
  "CANDID_INTERNAL_EMAIL_DOMAINS",
] as const;

type EnvSnapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

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

function setTestPilotEnv() {
  process.env.CANDID_COMMUNICATION_MODE = "test";
  process.env.CANDID_TEST_EMAIL_RECIPIENT = "pilot-test@candidcreative.uk";
}

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

describe("communication mode resolution", () => {
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("1. CANDID_COMMUNICATION_MODE=live allows external email delivery", () => {
    process.env.CANDID_COMMUNICATION_MODE = "live";

    const result = applyCommunicationSafety({
      intendedRecipient: "sarah@customer.com",
      subject: "Your quote is ready",
      html: "<p>Quote body</p>",
    });

    assert.equal(getCommunicationConfig().mode, "live");
    assert.equal(result.mode, "live");
    assert.equal(result.redirected, false);
    assert.equal(result.actualRecipient, "sarah@customer.com");
    assert.equal(result.shouldSend, true);
  });

  it("2. CANDID_COMMUNICATION_MODE=test redirects external email", () => {
    setTestPilotEnv();

    const result = applyCommunicationSafety({
      intendedRecipient: "sarah@customer.com",
      subject: "Your quote is ready",
      html: "<p>Quote body</p>",
    });

    assert.equal(getCommunicationConfig().mode, "test");
    assert.equal(result.redirected, true);
    assert.equal(result.actualRecipient, "pilot-test@candidcreative.uk");
  });

  it("3. missing CANDID var + EMAIL_MODE=live is NOT live", () => {
    delete process.env.CANDID_COMMUNICATION_MODE;
    process.env.EMAIL_MODE = "live";
    process.env.CANDID_TEST_EMAIL_RECIPIENT = "pilot-test@candidcreative.uk";

    assert.equal(getCommunicationConfig().mode, "test");

    const result = applyCommunicationSafety({
      intendedRecipient: "sarah@customer.com",
      subject: "Quote",
      html: "<p>Quote</p>",
    });

    assert.notEqual(result.mode, "live");
    assert.equal(result.redirected, true);
    assert.equal(result.actualRecipient, "pilot-test@candidcreative.uk");
  });

  it("4. invalid CANDID var + EMAIL_MODE=live is NOT live", () => {
    process.env.CANDID_COMMUNICATION_MODE = "production";
    process.env.EMAIL_MODE = "live";
    process.env.CANDID_TEST_EMAIL_RECIPIENT = "pilot-test@candidcreative.uk";

    assert.equal(getCommunicationConfig().mode, "test");

    const result = applyCommunicationSafety({
      intendedRecipient: "sarah@customer.com",
      subject: "Quote",
      html: "<p>Quote</p>",
    });

    assert.notEqual(result.mode, "live");
    assert.equal(result.redirected, true);
    assert.equal(result.actualRecipient, "pilot-test@candidcreative.uk");
  });

  it("5. EMAIL_MODE=disabled suppresses regardless of CANDID mode", () => {
    process.env.CANDID_COMMUNICATION_MODE = "live";
    process.env.EMAIL_MODE = "disabled";

    assert.equal(getCommunicationConfig().mode, "suppressed");

    const result = applyCommunicationSafety({
      intendedRecipient: "sarah@customer.com",
      subject: "Quote",
      html: "<p>Quote</p>",
    });

    assert.equal(result.mode, "suppressed");
    assert.equal(result.shouldSend, false);
    assert.equal(result.redirected, false);
  });

  it("6. missing test recipient while effective mode is test blocks external email", () => {
    process.env.CANDID_COMMUNICATION_MODE = "test";
    delete process.env.CANDID_TEST_EMAIL_RECIPIENT;
    delete process.env.EMAIL_TEST_RECIPIENT;

    assert.equal(getCommunicationConfig().mode, "test");

    const result = applyCommunicationSafety({
      intendedRecipient: "sarah@customer.com",
      subject: "Quote",
      html: "<p>Quote</p>",
    });

    assert.equal(result.shouldSend, false);
    assert.equal(result.missingTestRecipient, true);
  });
});

describe("communication safety redirect", () => {
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("A. test mode + customer To redirects to test recipient only", () => {
    setTestPilotEnv();

    const result = applyCommunicationSafety({
      intendedRecipient: "Sarah Smith <sarah@customer.com>",
      subject: "Your quote is ready",
      html: "<p>Quote body</p>",
    });

    assert.equal(result.mode, "test");
    assert.equal(result.shouldSend, true);
    assert.equal(result.redirected, true);
    assert.equal(result.actualRecipient, "pilot-test@candidcreative.uk");
    assert.equal(result.actualCc.length, 0);
    assert.equal(result.actualBcc.length, 0);
    assert.equal(result.subject, "[TEST] Your quote is ready");
    assert.match(result.html, /TEST EMAIL — CUSTOMER NOT CONTACTED/);
    assert.match(result.html, /sarah@customer\.com/);
  });

  it("B. test mode + customer To + customer CC redirects to test recipient only", () => {
    setTestPilotEnv();

    const result = applyCommunicationSafety({
      intendedRecipient: "sarah@customer.com",
      cc: ["finance@customer.com", "Sarah Smith <sarah@customer.com>"],
      subject: "Invoice available",
      html: "<p>Invoice</p>",
    });

    assert.equal(result.actualRecipient, "pilot-test@candidcreative.uk");
    assert.deepEqual(result.actualCc, []);
    assert.deepEqual(result.actualBcc, []);
    assert.equal(result.redirected, true);
    assert.match(result.html, /finance@customer\.com/);
    assert.match(result.html, /sarah@customer\.com/);
  });

  it("C. test mode + customer BCC redirects to test recipient only", () => {
    setTestPilotEnv();

    const result = applyCommunicationSafety({
      intendedRecipient: "ops@candidcreative.uk",
      bcc: ["hidden@customer.com"],
      subject: "Internal copy",
      html: "<p>Body</p>",
    });

    assert.equal(result.actualRecipient, "pilot-test@candidcreative.uk");
    assert.deepEqual(result.actualBcc, []);
    assert.equal(result.redirected, true);
    assert.match(result.html, /hidden@customer\.com/);
  });

  it("D. test mode + multiple external recipients redirects to test recipient only", () => {
    setTestPilotEnv();

    const result = applyCommunicationSafety({
      intendedRecipient: "one@customer.com",
      cc: ["two@customer.com"],
      bcc: ["three@customer.com"],
      subject: "Multi recipient",
      html: "<p>Body</p>",
    });

    assert.equal(result.actualRecipient, "pilot-test@candidcreative.uk");
    assert.deepEqual(result.actualCc, []);
    assert.deepEqual(result.actualBcc, []);
    assert.equal(result.intendedRecipients.length, 3);
  });

  it("E. invalid/missing communication mode defaults to test and blocks external send without recipient", () => {
    delete process.env.CANDID_COMMUNICATION_MODE;
    delete process.env.EMAIL_MODE;
    delete process.env.CANDID_TEST_EMAIL_RECIPIENT;
    delete process.env.EMAIL_TEST_RECIPIENT;

    assert.equal(getCommunicationConfig().mode, "test");

    const result = applyCommunicationSafety({
      intendedRecipient: "sarah@customer.com",
      subject: "Quote",
      html: "<p>Quote</p>",
    });

    assert.equal(result.shouldSend, false);
    assert.equal(result.missingTestRecipient, true);
  });

  it("F. live mode preserves original recipients", () => {
    process.env.CANDID_COMMUNICATION_MODE = "live";
    process.env.CANDID_TEST_EMAIL_RECIPIENT = "pilot-test@candidcreative.uk";

    const result = applyCommunicationSafety({
      intendedRecipient: "sarah@customer.com",
      cc: ["finance@customer.com"],
      bcc: ["audit@customer.com"],
      subject: "Your quote is ready",
      html: "<p>Quote body</p>",
    });

    assert.equal(result.mode, "live");
    assert.equal(result.redirected, false);
    assert.equal(result.actualRecipient, "sarah@customer.com");
    assert.deepEqual(result.actualCc, ["finance@customer.com"]);
    assert.deepEqual(result.actualBcc, ["audit@customer.com"]);
    assert.equal(result.subject, "Your quote is ready");
    assert.doesNotMatch(result.html, /TEST EMAIL — CUSTOMER NOT CONTACTED/);
  });

  it("internal-only email in test mode passes through unchanged", () => {
    setTestPilotEnv();

    const result = applyCommunicationSafety({
      intendedRecipient: "dan@candidcreative.uk",
      cc: ["production@candidcreative.uk"],
      subject: "PrintFactory unmatched file",
      html: "<p>Internal alert</p>",
    });

    assert.equal(result.redirected, false);
    assert.equal(result.actualRecipient, "dan@candidcreative.uk");
    assert.deepEqual(result.actualCc, ["production@candidcreative.uk"]);
    assert.equal(result.passthroughInternal, true);
  });
});

describe("notification path coverage", () => {
  it("I. quote-ready emails route through sendEmailThroughResend safety layer", async () => {
    const resendClientSource = await readRepoFile("lib/notifications/resend-client.ts");
    const sendNotificationSource = await readRepoFile("lib/notifications/send-notification.ts");
    const triggersSource = await readRepoFile("lib/notifications/triggers.ts");

    assert.match(resendClientSource, /applyCommunicationSafety/);
    assert.match(sendNotificationSource, /sendEmailThroughResend/);
    assert.match(triggersSource, /sendNotification/);
  });

  it("J. proof notifications route through shared send-notification delivery", async () => {
    const proofNotificationsSource = await readRepoFile("lib/proofs/notifications.ts");

    assert.match(proofNotificationsSource, /sendNotification/);
  });

  it("K. admin email connectivity test routes through sendEmailThroughResend", async () => {
    const routeSource = await readRepoFile("app/api/admin/settings/email/test/route.ts");

    assert.match(routeSource, /sendEmailThroughResend/);
  });
});

describe("Slack and notification audit behaviour", () => {
  it("G. Slack delivery is independent of email communication mode", async () => {
    const { buildSlackJobChannelIdempotencyKey } = await import("@/lib/slack/idempotency");

    process.env.CANDID_COMMUNICATION_MODE = "test";

    assert.equal(getCommunicationConfig().mode, "test");
    assert.match(
      buildSlackJobChannelIdempotencyKey("job-123"),
      /^slack:job_channel_created:/
    );
  });

  it("H. notification metadata captures intended vs actual recipients", () => {
    setTestPilotEnv();

    const safety = applyCommunicationSafety({
      intendedRecipient: "sarah@customer.com",
      subject: "Quote ready",
      html: "<p>Body</p>",
    });

    const metadata = {
      communicationMode: getCommunicationConfig().mode,
      redirected: safety.redirected,
      intendedRecipients: safety.intendedRecipients,
      intended_to: "sarah@customer.com",
      actual_to: safety.actualRecipient,
      mode: getCommunicationConfig().mode,
    };

    assert.equal(metadata.intended_to, "sarah@customer.com");
    assert.equal(metadata.actual_to, "pilot-test@candidcreative.uk");
    assert.equal(metadata.mode, "test");
    assert.equal(metadata.redirected, true);
    assert.notEqual(metadata.intended_to, metadata.actual_to);
  });
});
