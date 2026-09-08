import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyCommunicationSafety } from "@/lib/communications/safety";
import {
  buildSendQuoteResponse,
  interpretQuoteReadyNotificationResult,
} from "@/lib/quotes/send-quote";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

describe("interpretQuoteReadyNotificationResult", () => {
  it("5. treats provider failure as emailSent=false", () => {
    const result = interpretQuoteReadyNotificationResult({
      ok: false,
      notificationIds: ["notification-1"],
      results: [
        {
          notificationId: "notification-1",
          status: "failed",
          recipientEmail: null,
          intendedRecipientEmail: "customer@example.com",
          providerMessageId: null,
          error: "Resend is not configured. Missing: RESEND_API_KEY",
          errorCode: "resend_not_configured",
        },
      ],
      skippedReason: "resend_not_configured",
      failureReason: "resend_not_configured",
      adminMessage: "Resend is not configured.",
    });

    assert.equal(result.emailSent, false);
    assert.match(result.emailError ?? "", /not configured/i);
    assert.equal(result.email.notificationId, "notification-1");
    assert.equal(result.email.errorCode, "resend_not_configured");
  });

  it("7. distinguishes delivered email from quote send state metadata", () => {
    const success = interpretQuoteReadyNotificationResult({
      ok: true,
      notificationIds: ["notification-2"],
      results: [
        {
          notificationId: "notification-2",
          status: "sent",
          recipientEmail: "pilot-test@candidcreative.uk",
          intendedRecipientEmail: "customer@example.com",
          providerMessageId: "resend-message-id",
          error: null,
          errorCode: null,
        },
      ],
    });

    assert.equal(success.emailSent, true);
    assert.equal(success.emailError, null);
    assert.equal(success.email.intendedRecipient, "customer@example.com");
    assert.equal(success.email.actualRecipient, "pilot-test@candidcreative.uk");
  });

  it("6. reports email failure without implying delivery succeeded", () => {
    const result = interpretQuoteReadyNotificationResult({
      ok: false,
      skippedReason: "missing_recipient",
      notificationIds: ["notification-3"],
      results: [],
      failureReason: "missing_recipient",
      adminMessage: "No recipient email address was found.",
    });

    assert.equal(result.emailSent, false);
    assert.ok(result.emailError);
  });
});

describe("buildSendQuoteResponse", () => {
  it("1. opportunity-linked send still returns quoteSent with CRM sync metadata", () => {
    const response = buildSendQuoteResponse({
      opportunityResult: {
        ok: true,
        opportunityId: "opp-1",
        stage: "quote_sent",
      },
      notification: {
        ok: true,
        notificationIds: ["notification-4"],
        results: [
          {
            notificationId: "notification-4",
            status: "sent",
            recipientEmail: "dan@candidcreative.uk",
            intendedRecipientEmail: "customer@example.com",
            providerMessageId: "provider-1",
            error: null,
            errorCode: null,
          },
        ],
      },
    });

    assert.equal(response.quoteSent, true);
    assert.equal(response.emailSent, true);
    assert.equal(response.opportunitySynced, true);
    assert.equal(response.opportunitySkippedReason, null);
  });

  it("2. non-opportunity send still attempts email once", () => {
    const response = buildSendQuoteResponse({
      opportunityResult: {
        ok: true,
        skipped: true,
        reason: "Quote is not linked to an opportunity.",
      },
      notification: {
        ok: true,
        notificationIds: ["notification-5"],
        results: [
          {
            notificationId: "notification-5",
            status: "sent",
            recipientEmail: "dan@candidcreative.uk",
            intendedRecipientEmail: "customer@example.com",
            providerMessageId: "provider-2",
            error: null,
            errorCode: null,
          },
        ],
      },
    });

    assert.equal(response.quoteSent, true);
    assert.equal(response.emailSent, true);
    assert.equal(response.opportunitySynced, false);
    assert.equal(
      response.opportunitySkippedReason,
      "Quote is not linked to an opportunity."
    );
  });

  it("6. preserves quoteSent when email fails", () => {
    const response = buildSendQuoteResponse({
      opportunityResult: {
        ok: true,
        skipped: true,
        reason: "Quote is not linked to an opportunity.",
      },
      notification: {
        ok: false,
        notificationIds: ["notification-6"],
        results: [
          {
            notificationId: "notification-6",
            status: "failed",
            recipientEmail: null,
            intendedRecipientEmail: "customer@example.com",
            providerMessageId: null,
            error: "Provider rejected the message.",
            errorCode: "provider_rejection",
          },
        ],
        failureReason: "provider_rejection",
      },
    });

    assert.equal(response.quoteSent, true);
    assert.equal(response.emailSent, false);
    assert.match(response.emailError ?? "", /Provider rejected/i);
  });

  it("8. records CRM sync errors separately without blocking email result", () => {
    const response = buildSendQuoteResponse({
      opportunityResult: {
        ok: false,
        message: "Linked opportunity not found.",
      },
      notification: {
        ok: true,
        notificationIds: ["notification-7"],
        results: [
          {
            notificationId: "notification-7",
            status: "sent",
            recipientEmail: "dan@candidcreative.uk",
            intendedRecipientEmail: "customer@example.com",
            providerMessageId: "provider-3",
            error: null,
            errorCode: null,
          },
        ],
      },
    });

    assert.equal(response.quoteSent, true);
    assert.equal(response.emailSent, true);
    assert.equal(response.opportunitySyncError, "Linked opportunity not found.");
    assert.equal(response.opportunitySynced, false);
  });
});

describe("send quote architecture", () => {
  it("3. CRM sync route no longer sends quote_ready emails", async () => {
    const source = await readRepoFile("app/api/crm/quotes/[id]/sync/route.ts");

    assert.doesNotMatch(source, /notifyQuoteReadySafe/);
    assert.match(source, /syncOpportunityFromQuoteEvent/);
  });

  it("1-2. dedicated admin send route owns quote delivery", async () => {
    const routeSource = await readRepoFile("app/api/admin/quotes/[id]/send/route.ts");
    const serviceSource = await readRepoFile("lib/quotes/send-quote.ts");

    assert.match(routeSource, /sendQuoteAsStaff/);
    assert.match(serviceSource, /notifyQuoteReadySafe/);
    assert.match(serviceSource, /syncOpportunityFromQuoteEvent/);
    assert.doesNotMatch(serviceSource, /client\.emails\.send/);
  });

  it("3. send service uses one notification call path per operation", async () => {
    const source = await readRepoFile("lib/quotes/send-quote.ts");
    const sendMatches = source.match(
      /export async function sendQuoteAsStaff[\s\S]*?^}/m
    )?.[0];
    const resendMatches = source.match(
      /export async function resendQuoteAsStaff[\s\S]*?^}/m
    )?.[0];

    assert.ok(sendMatches);
    assert.ok(resendMatches);
    assert.equal((sendMatches.match(/await notifyQuoteReadySafe\(/g) ?? []).length, 1);
    assert.equal((resendMatches.match(/await notifyQuoteReadySafe\(/g) ?? []).length, 1);
  });

  it("7. quote builder uses server send endpoint and accurate messaging", async () => {
    const source = await readRepoFile("components/quote-builder-form.tsx");

    assert.match(source, /\/api\/admin\/quotes\/\$\{quoteId\}\/send/);
    assert.match(source, /Quote sent successfully\./);
    assert.match(
      source,
      /Quote was marked as sent, but the email could not be delivered\./
    );
    assert.doesNotMatch(
      source,
      /targetStatus === "sent" && opportunityId[\s\S]*syncQuoteOpportunityStage\(quoteId, "quote_sent"\)/
    );
  });

  it("9. public registration safety remains unchanged", async () => {
    const registerRoute = await readRepoFile("app/api/auth/register/route.ts");
    const sendRoute = await readRepoFile("app/api/admin/quotes/[id]/send/route.ts");

    assert.match(registerRoute, /assertPublicRegistrationEnabled/);
    assert.doesNotMatch(sendRoute, /register/);
  });
});

describe("TEST communication mode for quote send", () => {
  const ENV_KEYS = [
    "CANDID_COMMUNICATION_MODE",
    "CANDID_TEST_EMAIL_RECIPIENT",
  ] as const;
  let envSnapshot: Record<(typeof ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    envSnapshot = Object.fromEntries(
      ENV_KEYS.map((key) => [key, process.env[key]])
    ) as Record<(typeof ENV_KEYS)[number], string | undefined>;
    process.env.CANDID_COMMUNICATION_MODE = "test";
    process.env.CANDID_TEST_EMAIL_RECIPIENT = "dan@candidcreative.uk";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (envSnapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envSnapshot[key];
      }
    }
  });

  it("4. redirects external quote recipients in TEST mode", () => {
    const result = applyCommunicationSafety({
      intendedRecipient: "hello@dan-co.uk",
      subject: "Your quote is ready",
      html: "<p>Quote body</p>",
    });

    assert.equal(result.redirected, true);
    assert.equal(result.actualRecipient, "dan@candidcreative.uk");
    assert.equal(result.shouldSend, true);
  });

  it("10. internal recipients remain passthrough in TEST mode", () => {
    const result = applyCommunicationSafety({
      intendedRecipient: "dan@candidcreative.uk",
      subject: "Internal quote update",
      html: "<p>Internal</p>",
    });

    assert.equal(result.redirected, false);
    assert.equal(result.actualRecipient, "dan@candidcreative.uk");
    assert.equal(result.shouldSend, true);
  });
});
