import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { classifyPdfText } from "@/lib/gmail/classify";
import {
  classifyDocumentRelevance,
  promotionQueue,
  storedDocumentRelevance,
} from "@/lib/gmail/relevance";

const creditsafe = `Creditsafe
Overdue payment reminder
The following invoices remain unpaid.
Invoice number 445566
Please pay the overdue balance.`;

const statement = `Statement of account
Pyramid Display Materials
Invoice number SI100
Invoice number SI101
Balance brought forward`;

const pyramid = `Pyramid Display Materials
SALES INVOICE
Invoice No. SI1311911
Invoice date: 12 May 2026
Payment terms: 30 days
Overdue balances may be subject to charges.
No. Description Quantity Unit
Board 1 Sheet 10.00`;

const allPrint = `All Print Supplies
TAX INVOICE
Invoice No. APS-2044
Invoice date: 2 June 2026
Payment terms 30 days from invoice date.
Please pay this invoice by the due date.`;

const ambiguous = `Hello,
Please find your invoice attached.
Kind regards`;

test("a Creditsafe overdue reminder is excluded even though it lists an invoice number", () => {
  const relevance = classifyDocumentRelevance(creditsafe);
  assert.equal(relevance.relevance, "irrelevant");
  assert.match(relevance.reason, /overdue-payment reminder/);
  assert.equal(classifyPdfText(creditsafe), "unknown");
});

test("a supplier statement is excluded even though it lists invoice numbers", () => {
  const relevance = classifyDocumentRelevance(statement);
  assert.equal(relevance.relevance, "irrelevant");
  assert.match(relevance.reason, /supplier statement/);
  assert.equal(classifyPdfText(statement), "unknown");
});

test("a dunning letter is excluded even though it lists invoice numbers", () => {
  assert.match(
    classifyDocumentRelevance("Dunning letter\nInvoice number 01SI-2368836-20\nTotal 100.00 GBP").reason,
    /credit-control letter/
  );
});

test("a credit-control letter is excluded", () => {
  const text = "Credit control\nInvoice number 88 is overdue.\nLetter before action.";
  assert.equal(classifyDocumentRelevance(text).relevance, "irrelevant");
  assert.equal(classifyPdfText(text), "unknown");
});

test("a genuine Pyramid invoice stays an invoice when it mentions overdue charges", () => {
  assert.equal(classifyDocumentRelevance(pyramid).relevance, "supplier_invoice");
  assert.equal(classifyPdfText(pyramid), "invoice");
});

test("a genuine All Print Supplies invoice stays an invoice when it includes payment terms", () => {
  assert.equal(classifyDocumentRelevance(allPrint).relevance, "supplier_invoice");
  assert.equal(classifyPdfText(allPrint), "invoice");
});

test("a sales invoice stays an invoice when the footer mentions remittance advice", () => {
  const text = `${allPrint}\nRemittance advice is shown on the following page.`;
  assert.equal(classifyDocumentRelevance(text).relevance, "supplier_invoice");
});

test("a remittance advice and a payment receipt are excluded", () => {
  assert.match(classifyDocumentRelevance("Remittance advice\nCandid Creative Limited").reason, /remittance advice/);
  assert.match(classifyDocumentRelevance("Official receipt\nPayment receipt 100").reason, /receipt/);
});

test("an Antalis invoice heading and a statement page are distinguished", () => {
  const antalis = "Antalis Ltd\ninvoice: 6701468943\ntax date: 14.08.2026\nGoods";
  assert.equal(classifyDocumentRelevance(antalis).relevance, "supplier_invoice");
  assert.equal(classifyPdfText(antalis), "invoice");
  assert.match(classifyDocumentRelevance("statement page 1 of 1\nPPB Ltd\ninvoice 123456").reason, /supplier statement/);
  assert.equal(classifyDocumentRelevance("Please settle invoice: tomorrow.").relevance, "needs_review");
});

test("the word invoice alone needs manual classification", () => {
  const relevance = classifyDocumentRelevance(ambiguous);
  assert.equal(relevance.relevance, "needs_review");
  assert.equal(classifyPdfText(ambiguous), "unknown");
  assert.equal(classifyPdfText("Invoice"), "unknown");
});

test("an unknown or unapproved supplier stays manual and an approved match can be automatic", () => {
  assert.equal(
    promotionQueue({
      supplierMatched: false,
      supplierApproved: false,
      relevance: "supplier_invoice",
      status: "stored",
      documentType: "invoice",
    }).queue,
    "manual"
  );
  assert.equal(
    promotionQueue({
      supplierMatched: true,
      supplierApproved: false,
      relevance: "supplier_invoice",
      status: "stored",
      documentType: "invoice",
    }).selectable,
    false
  );
  const approved = promotionQueue({
    supplierMatched: true,
    supplierApproved: true,
    relevance: "supplier_invoice",
    status: "stored",
    documentType: "invoice",
  });
  assert.equal(approved.queue, "automatic");
  assert.equal(approved.selectable, true);
  assert.equal(
    promotionQueue({
      supplierMatched: true,
      supplierApproved: true,
      relevance: "irrelevant",
      status: "stored",
      documentType: "invoice",
    }).queue,
    "excluded"
  );
});

test("stored exclusion text is recognised without a new document type", () => {
  assert.equal(
    storedDocumentRelevance({ detail: "Excluded as irrelevant: overdue-payment reminder." }),
    "irrelevant"
  );
  assert.equal(
    storedDocumentRelevance({ detail: "Marked as not a supplier invoice. The original PDF and checksum are unchanged." }),
    "irrelevant"
  );
  assert.equal(storedDocumentRelevance({ promotionRelevance: "needs_review" }), "needs_review");
});

test("the eligibility migration is additive and does not approve suppliers or reopen runs", async () => {
  const sql = await readFile(
    new URL("../../supabase/migrations/20261026200000_supplier_invoice_eligibility.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS gmail_auto_processing_enabled boolean NOT NULL DEFAULT false/);
  assert.match(sql, /promotion_relevance IN \('supplier_invoice', 'needs_review', 'irrelevant'\)/);
  assert.match(sql, /GRANT UPDATE \(status, detail, promotion_relevance\)/);
  assert.match(sql, /REVOKE ALL ON TABLE public.gmail_import_items FROM anon/);
  assert.doesNotMatch(sql, /UPDATE public\.suppliers/);
  assert.doesNotMatch(sql, /gmail_auto_processing_enabled\s*=\s*true/);
  assert.doesNotMatch(sql, /invoice_processing_runs/);
  assert.doesNotMatch(sql, /material_prices/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.materials/);
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});
