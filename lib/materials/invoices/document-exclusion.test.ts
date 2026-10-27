import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDocumentExclusion,
  documentExclusionPlan,
  exclusionReprocessBlock,
} from "@/lib/materials/invoices/document-exclusion";

test("manual exclusion ignores the review record, skips the Gmail item, and keeps the invoice", () => {
  const plan = documentExclusionPlan({
    id: "invoice-1",
    gmailImportItemId: "gmail-1",
  });

  assert.equal(plan.deletesInvoice, false);
  assert.deepEqual(plan.writes, ["supplier_invoices", "gmail_import_items"]);
  assert.equal(plan.invoice.processing_status, "ignored");
  assert.equal(plan.gmail?.status, "skipped");
  assert.match(plan.gmail?.detail ?? "", /PDF and checksum are unchanged/);
  assert.equal(plan.gmail?.promotion_relevance, "irrelevant");
  assert.equal(
    exclusionReprocessBlock({
      processingStatus: "ignored",
      gmailStatus: "skipped",
      gmailDetail: plan.gmail?.detail ?? null,
    }),
    "This document was marked as not a supplier invoice. Reprocessing was stopped."
  );
});

test("manual exclusion does not write materials, products, or approved prices", async () => {
  const writes: string[] = [];
  const result = await applyDocumentExclusion(
    {
      async loadInvoice() {
        return { id: "invoice-1", gmailImportItemId: "gmail-1" };
      },
      async updateInvoice(update) {
        writes.push(`supplier_invoices:${update.processing_status}`);
      },
      async updateGmailItem(update) {
        writes.push(`gmail_import_items:${update.status}`);
      },
    },
    "invoice-1"
  );

  assert.equal(result.ok, true);
  assert.deepEqual(writes, ["supplier_invoices:ignored", "gmail_import_items:skipped"]);
  assert.equal(writes.some((write) => /material|price|product/.test(write)), false);
});
