import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateCustomerQuotePdf } from "@/lib/generate-customer-quote-pdf";
import type { CustomerFormalQuotePdfInput } from "@/lib/customer-formal-quote-data";

const testDir = path.dirname(fileURLToPath(import.meta.url));

function countPdfPages(buffer: Buffer) {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

function buildSampleQuote(
  overrides: Partial<CustomerFormalQuotePdfInput> = {}
): CustomerFormalQuotePdfInput {
  return {
    quoteId: "test-quote",
    quoteNumber: 1,
    projectName: "Pilot Test Panels",
    quoteStatus: "sent",
    versionStatus: "sent",
    versionNumber: 1,
    currentVersion: 1,
    canRespondToQuote: true,
    decisionState: "pending",
    dateSent: "2026-09-01T00:00:00.000Z",
    expiryDate: "2026-10-01T00:00:00.000Z",
    paymentTermsDays: 30,
    introduction: null,
    customerNotes: null,
    subtotal: 500,
    vatAmount: 100,
    total: 600,
    lineItems: [
      {
        id: "line-1",
        title: "Test Panel",
        description: "Sample line item",
        quantity: 2,
        unitPrice: 250,
        lineTotal: 500,
        isOptional: false,
        imageUrl: null,
        imageFileName: null,
      },
    ],
    linkedRequestId: null,
    linkedJobId: null,
    linkedJobReference: null,
    customerCompanyName: "Pilot Test Co",
    customerContactName: "Test User",
    customerEmail: "test@example.com",
    approvedDeadline: null,
    ...overrides,
  };
}

describe("generateCustomerQuotePdf pagination", () => {
  it("uses tighter dedicated Terms & Conditions layout constants", async () => {
    const source = await readFile(path.join(testDir, "generate-customer-quote-pdf.ts"), "utf8");

    assert.match(source, /TERMS_BODY_FONT_SIZE = 9/);
    assert.match(source, /drawTermsMainHeading/);
    assert.match(source, /drawTermsBodyText/);
    assert.match(source, /measureTermsBlockHeight/);
    assert.doesNotMatch(source, /drawSectionHeading\(doc, "Terms & Conditions"/);
  });

  it("fits a Q-1-equivalent short quote onto two pages", async () => {
    const pdfBuffer = await generateCustomerQuotePdf(buildSampleQuote());

    assert.equal(countPdfPages(pdfBuffer), 2);
  });

  it("still paginates dynamically when commercial content grows", async () => {
    const lineItems = Array.from({ length: 12 }, (_, index) => ({
      id: `line-${index + 1}`,
      title: `Panel ${index + 1}`,
      description: "Sample production item",
      quantity: 1,
      unitPrice: 100,
      lineTotal: 100,
      isOptional: false,
      imageUrl: null,
      imageFileName: null,
    }));

    const pdfBuffer = await generateCustomerQuotePdf(
      buildSampleQuote({
        projectName: "Large multi-item quote",
        subtotal: 1200,
        vatAmount: 240,
        total: 1440,
        lineItems,
      })
    );

    assert.ok(countPdfPages(pdfBuffer) >= 3);
  });
});
