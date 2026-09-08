import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isAdminQuotePdfDownloadable } from "@/lib/customer-quote-request";
import {
  buildResendQuoteResponse,
  resendQuoteAsStaff,
} from "@/lib/quotes/send-quote";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

describe("quote PDF download", () => {
  it("1. professional PDF generator remains wired to shared response helper", async () => {
    const shared = await readRepoFile("lib/quotes/quote-pdf-response.ts");
    const generator = await readRepoFile("lib/generate-customer-quote-pdf.ts");
    const customerRoute = await readRepoFile("app/api/quotes/[id]/pdf/route.ts");
    const adminRoute = await readRepoFile("app/api/admin/quotes/[id]/pdf/route.ts");
    const nextConfig = await readRepoFile("next.config.ts");

    assert.match(shared, /import\(\s*"@\/lib\/generate-customer-quote-pdf"\s*\)/);
    assert.match(shared, /generateCustomerQuotePdf/);
    assert.match(shared, /Content-Type": "application\/pdf"/);
    assert.match(generator, /LOGO_YELLOW\.png/);
    assert.doesNotMatch(generator, /import sharp from "sharp"/);
    assert.match(customerRoute, /createQuotePdfResponse/);
    assert.match(adminRoute, /createQuotePdfResponse/);
    assert.match(adminRoute, /verifyApprovedCrmStaff/);
    assert.match(nextConfig, /outputFileTracingIncludes/);
    assert.match(nextConfig, /node_modules\/pdfkit\/js\/data\/\*\*/);
    assert.match(nextConfig, /LOGO_YELLOW\.png/);
  });

  it("admin and customer PDF routes force Node runtime", async () => {
    const customerRoute = await readRepoFile("app/api/quotes/[id]/pdf/route.ts");
    const adminRoute = await readRepoFile("app/api/admin/quotes/[id]/pdf/route.ts");

    assert.match(customerRoute, /export const runtime = "nodejs"/);
    assert.match(adminRoute, /export const runtime = "nodejs"/);
  });

  it("customer PDF route preserves portal authentication", async () => {
    const customerRoute = await readRepoFile("app/api/quotes/[id]/pdf/route.ts");

    assert.match(customerRoute, /loadCustomerPortalProfile/);
    assert.match(customerRoute, /Unauthorized\./);
  });

  it("shared PDF response lazy-loads generator and returns safe errors", async () => {
    const shared = await readRepoFile("lib/quotes/quote-pdf-response.ts");

    assert.doesNotMatch(
      shared,
      /^import \{ generateCustomerQuotePdf \} from "@\/lib\/generate-customer-quote-pdf";/m
    );
    assert.match(shared, /Unable to generate PDF\./);
    assert.match(shared, /\[quote-pdf\] failed/);
  });

  it("2. admin quote UI exposes Download PDF", async () => {
    const page = await readRepoFile("app/admin/quotes/[id]/page.tsx");
    const actions = await readRepoFile("components/admin-quote-document-actions.tsx");
    const button = await readRepoFile("components/customer-quote-download-pdf-button.tsx");

    assert.match(page, /AdminQuoteDocumentActions/);
    assert.match(actions, /QuoteDownloadPdfButton/);
    assert.match(button, /Download PDF/);
    assert.match(actions, /\/api\/admin\/quotes\/\$\{quoteId\}\/pdf/);
  });

  it("allows admin preview PDFs for draft versions", () => {
    assert.equal(isAdminQuotePdfDownloadable("draft"), true);
    assert.equal(isAdminQuotePdfDownloadable("sent"), true);
    assert.equal(isAdminQuotePdfDownloadable("superseded"), true);
  });
});

describe("resend quote architecture", () => {
  it("4. sent quote exposes Resend Quote in admin UI", async () => {
    const actions = await readRepoFile("components/admin-quote-document-actions.tsx");

    assert.match(actions, /Resend quote/);
    assert.match(actions, /resend: true/);
    assert.match(actions, /Quote resent successfully\./);
    assert.match(
      actions,
      /Quote remains sent, but the email could not be delivered\./
    );
  });

  it("3. draft quote builder still uses Send Quote only", async () => {
    const form = await readRepoFile("components/quote-builder-form.tsx");

    assert.match(form, /Send quote/);
    assert.doesNotMatch(form, /Resend quote/);
    assert.match(form, /\/api\/admin\/quotes\/\$\{quoteId\}\/send/);
    assert.doesNotMatch(form, /resend: true/);
  });

  it("5-6. resend uses one notification attempt and does not mutate quote state", async () => {
    const service = await readRepoFile("lib/quotes/send-quote.ts");
    const triggers = await readRepoFile("lib/notifications/triggers.ts");

    assert.match(service, /resend: true/);
    assert.doesNotMatch(
      service,
      /resendQuoteAsStaff[\s\S]*version_status: "sent"/
    );
    assert.doesNotMatch(
      service,
      /resendQuoteAsStaff[\s\S]*syncOpportunityFromQuoteEvent/
    );
    assert.match(triggers, /quote_ready:\$\{quote\.id\}:\$\{version\.id\}:resend:/);
    assert.match(triggers, /resend: true/);
  });

  it("7-8. resend preserves sent state and uses fresh idempotency keys", async () => {
    const service = await readRepoFile("lib/quotes/send-quote.ts");

    assert.doesNotMatch(service, /resendQuoteAsStaff[\s\S]*sent_at:/);
    assert.doesNotMatch(service, /resendQuoteAsStaff[\s\S]*\.update\(\{[\s\S]*status: "sent"/);
    assert.match(service, /Only the current sent quote version can be resent\./);
  });

  it("10. resend surfaces provider failure separately from success messaging", () => {
    const response = buildResendQuoteResponse({
      notification: {
        ok: false,
        notificationIds: ["notification-resend-1"],
        results: [
          {
            notificationId: "notification-resend-1",
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

    assert.equal(response.resent, true);
    assert.equal(response.emailSent, false);
    assert.match(response.emailError ?? "", /Provider rejected/i);
  });

  it("11. resend UI disables action while request is in progress", async () => {
    const actions = await readRepoFile("components/admin-quote-document-actions.tsx");

    assert.match(actions, /if \(isResending\)/);
    assert.match(actions, /disabled=\{isResending/);
  });
});

describe("resendQuoteAsStaff guardrails", () => {
  it("6. rejects resend when version is not the current sent version", async () => {
    const adminClient = {
      from(table: string) {
        return {
          select() {
            return this;
          },
          eq(_column: string, value: string) {
            this._value = value;
            return this;
          },
          maybeSingle: async () => {
            if (table === "quotes") {
              return {
                data: {
                  id: "quote-1",
                  company_id: "company-1",
                  contact_id: "contact-1",
                  quote_request_id: null,
                  status: "sent",
                  current_version: 2,
                },
                error: null,
              };
            }

            if (table === "quote_versions") {
              return {
                data: {
                  id: "version-1",
                  version_number: 1,
                  version_status: "sent",
                  sent_at: "2026-09-08T10:00:00.000Z",
                },
                error: null,
              };
            }

            return { data: null, error: null };
          },
          _value: "",
        };
      },
    };

    const result = await resendQuoteAsStaff(adminClient as never, {
      quoteId: "quote-1",
      versionId: "version-1",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /current sent quote version/i);
    }
  });
});
