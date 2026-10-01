import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { findDuplicateInvoice } from "@/lib/materials/invoices/duplicate";
import { buildInvoiceDraft } from "@/lib/materials/invoices/draft";
import { extractPdfText } from "@/lib/materials/invoices/extract";
import { classifyInvoiceLine } from "@/lib/materials/invoices/match";
import type { InvoiceMatchProduct } from "@/lib/materials/invoices/model";
import { parseInvoiceText } from "@/lib/materials/invoices/parse";

const FIXTURE = `Supplier: Pyramid Display Materials
Invoice number: PY-2041
Invoice date: 2026-09-12
Subtotal: 186.35
VAT: 37.27
Total: 223.62
PQ80 5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC 1 sheet 41.75 41.75
5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC 1 sheet 43.10 43.10
5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC 1 sheet 39.50 39.50
Mystery vinyl 1370mm 1 roll 12.00 12.00
Broken maths line 2 sheet 20.00 50.00
`;

const pyramidProduct: InvoiceMatchProduct = {
  id: "foam-5",
  supplierId: "pyramid",
  sku: "PQ80",
  description: "5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC",
  materialName: "Foamalite 5mm PVC 3050mm x 1560mm",
  purchaseUnit: "sheet",
  thicknessMm: 5,
  colour: "White",
  widthMm: 3050,
  heightMm: 1560,
  lengthMm: null,
  currentPrice: 41.75,
  currentPriceUnit: "sheet",
};

const antalisProduct: InvoiceMatchProduct = {
  ...pyramidProduct,
  id: "foam-5-antalis",
  supplierId: "antalis",
  sku: "7301046",
  currentPrice: 23.35,
};

const tenMillimetre: InvoiceMatchProduct = {
  id: "foam-10",
  supplierId: "pyramid",
  sku: null,
  description: "Foamalite XPRESS filmed white 10mm 3050 x 1560",
  materialName: "Foamalite 10mm PVC 3050mm x 1560mm",
  purchaseUnit: "sheet",
  thicknessMm: 10,
  colour: "White",
  widthMm: 3050,
  heightMm: 1560,
  lengthMm: null,
  currentPrice: 70,
  currentPriceUnit: "sheet",
};

const suppliers = [
  { id: "pyramid", name: "Pyramid Display Materials", normalizedName: "pyramid display materials" },
  { id: "all-print", name: "All Print Supplies", normalizedName: "all print supplies" },
  { id: "antalis", name: "Antalis", normalizedName: "antalis" },
];

const aliases = [
  {
    supplierId: "pyramid",
    alias: "Pyramid Display Materials Ltd",
    normalizedAlias: "pyramid display materials ltd",
  },
];

describe("supplier invoice phase 1", () => {
  it("classifies a text invoice without writing a price", () => {
    const draft = buildInvoiceDraft({
      text: FIXTURE,
      extractionStatus: "extracted",
      suppliers,
      aliases,
      products: [pyramidProduct, antalisProduct],
      mappings: [],
      ignoreRules: [],
    });

    assert.equal(draft.supplierId, "pyramid");
    assert.equal(draft.invoiceNumber, "PY-2041");
    assert.equal(draft.invoiceDate, "2026-09-12");
    assert.equal(draft.lines.length, 5);
    assert.equal(draft.lines[0]?.reviewStatus, "processed");
    assert.equal(draft.lines[0]?.matchMethod, "sku");
    assert.equal(draft.lines[1]?.reviewStatus, "price_change");
    assert.equal(draft.lines[1]?.comparison?.difference, 1.35);
    assert.equal(draft.lines[1]?.comparison?.percent, 3.23);
    assert.equal(draft.lines[2]?.reviewStatus, "price_change");
    assert.equal(draft.lines[2]?.comparison?.difference, -2.25);
    assert.equal(draft.lines[2]?.comparison?.percent, -5.39);
    assert.equal(draft.lines[3]?.reviewStatus, "unmatched");
    assert.equal(draft.lines[3]?.matchedProductId, null);
    assert.equal(draft.lines[4]?.reviewStatus, "extraction_error");
    assert.match(draft.lines[4]?.mathsWarning ?? "", /50\.00/);
    assert.equal(draft.lines[0]?.matchedProductId, "foam-5");
  });

  it("does not treat Candid Creative or APS as a supplier", () => {
    const candid = buildInvoiceDraft({
      text: FIXTURE.replace("Pyramid Display Materials", "Candid Creative Ltd"),
      extractionStatus: "extracted",
      suppliers,
      aliases,
      products: [pyramidProduct],
      mappings: [],
      ignoreRules: [],
    });
    const aps = buildInvoiceDraft({
      text: FIXTURE.replace("Pyramid Display Materials", "APS"),
      extractionStatus: "extracted",
      suppliers,
      aliases,
      products: [pyramidProduct],
      mappings: [],
      ignoreRules: [],
    });

    assert.equal(candid.supplierId, null);
    assert.match(candid.supplierWarning ?? "", /not an external supplier/);
    assert.equal(aps.supplierId, null);
    assert.match(aps.supplierWarning ?? "", /not treated as All Print Supplies/);
    assert.equal(aps.lines[0]?.matchedProductId, null);
  });

  it("resolves a supplier alias and a learned description", () => {
    const aliased = buildInvoiceDraft({
      text: FIXTURE.replace(
        "Supplier: Pyramid Display Materials",
        "Supplier: Pyramid Display Materials Ltd"
      ),
      extractionStatus: "extracted",
      suppliers,
      aliases,
      products: [pyramidProduct],
      mappings: [],
      ignoreRules: [],
    });
    const learned = classifyInvoiceLine({
      line: {
        lineNumber: 1,
        rawDescription: "Bubble small 1500 x 100",
        rawSupplierSku: null,
        rawQuantity: 1,
        rawUnit: "roll",
        rawUnitPrice: 19.02,
        rawLineTotal: 19.02,
        rawTax: null,
      },
      supplierId: "pyramid",
      products: [
        {
          ...pyramidProduct,
          id: "bubble",
          sku: null,
          description: "Bubble Wrap 1500mm x 100m Small",
          materialName: "Bubble Wrap 1500mm",
          purchaseUnit: "roll",
          thicknessMm: null,
          colour: null,
          widthMm: 1500,
          heightMm: null,
          lengthMm: 100000,
          currentPrice: 19.02,
          currentPriceUnit: "roll",
        },
      ],
      mappings: [
        {
          supplierId: "pyramid",
          normalizedDescription: "bubble small 1500 x 100",
          productId: "bubble",
        },
      ],
      ignoreRules: [],
    });

    assert.equal(aliased.supplierId, "pyramid");
    assert.equal(learned.matchMethod, "mapping");
    assert.equal(learned.matchConfidence, "high");
    assert.equal(learned.reviewStatus, "processed");
  });

  it("keeps a medium specification match in review and ignores remembered carriage", () => {
    const probable = classifyInvoiceLine({
      line: {
        lineNumber: 1,
        rawDescription: "Foamalite XPRESS White 10mm 1560 x 3050",
        rawSupplierSku: null,
        rawQuantity: 1,
        rawUnit: "sheet",
        rawUnitPrice: 70,
        rawLineTotal: 70,
        rawTax: null,
      },
      supplierId: "pyramid",
      products: [tenMillimetre, pyramidProduct],
      mappings: [],
      ignoreRules: [],
    });
    const carriage = classifyInvoiceLine({
      line: {
        lineNumber: 2,
        rawDescription: "Carriage",
        rawSupplierSku: null,
        rawQuantity: 1,
        rawUnit: null,
        rawUnitPrice: 15,
        rawLineTotal: 15,
        rawTax: null,
      },
      supplierId: "pyramid",
      products: [pyramidProduct],
      mappings: [],
      ignoreRules: [
        { supplierId: "pyramid", normalizedDescription: "carriage" },
      ],
    });

    const fuzzy = classifyInvoiceLine({
      line: {
        lineNumber: 3,
        rawDescription: "Foamalite Xpress PVC board",
        rawSupplierSku: null,
        rawQuantity: 1,
        rawUnit: "sheet",
        rawUnitPrice: 41.75,
        rawLineTotal: 41.75,
        rawTax: null,
      },
      supplierId: "pyramid",
      products: [pyramidProduct],
      mappings: [],
      ignoreRules: [],
    });
    const otherSupplier = classifyInvoiceLine({
      line: {
        lineNumber: 4,
        rawDescription: pyramidProduct.description,
        rawSupplierSku: "7301046",
        rawQuantity: 1,
        rawUnit: "sheet",
        rawUnitPrice: 23.35,
        rawLineTotal: 23.35,
        rawTax: null,
      },
      supplierId: "pyramid",
      products: [antalisProduct],
      mappings: [],
      ignoreRules: [],
    });

    assert.equal(probable.reviewStatus, "needs_review");
    assert.equal(probable.matchConfidence, "medium");
    assert.equal(probable.matchedProductId, "foam-10");
    assert.equal(fuzzy.reviewStatus, "needs_review");
    assert.equal(fuzzy.matchConfidence, "low");
    assert.equal(fuzzy.matchMethod, "fuzzy");
    assert.equal(otherSupplier.reviewStatus, "unmatched");
    assert.equal(otherSupplier.matchedProductId, null);
    assert.equal(carriage.reviewStatus, "ignored");
  });

  it("flags header maths and returns an existing invoice for a duplicate", () => {
    const parsed = parseInvoiceText(
      FIXTURE.replace("Total: 223.62", "Total: 300.00")
    );
    const duplicate = findDuplicateInvoice({
      checksumSha256: "abc",
      supplierId: "pyramid",
      invoiceNumber: "PY-2041",
      invoiceDate: "2026-09-12",
      existing: [
        {
          id: "invoice-1",
          supplierId: "pyramid",
          invoiceNumber: "PY-2041",
          invoiceDate: "2026-09-12",
          checksumSha256: "other",
        },
      ],
    });
    const sameFile = findDuplicateInvoice({
      checksumSha256: "abc",
      supplierId: null,
      invoiceNumber: null,
      invoiceDate: null,
      existing: [
        {
          id: "invoice-1",
          supplierId: "pyramid",
          invoiceNumber: "PY-2041",
          invoiceDate: "2026-09-12",
          checksumSha256: "abc",
        },
      ],
    });

    const differentDate = findDuplicateInvoice({
      checksumSha256: "new-file",
      supplierId: "pyramid",
      invoiceNumber: "PY-2041",
      invoiceDate: "2026-10-01",
      existing: [
        {
          id: "invoice-1",
          supplierId: "pyramid",
          invoiceNumber: "PY-2041",
          invoiceDate: "2026-09-12",
          checksumSha256: "other",
        },
      ],
    });

    assert.ok(parsed.warnings.some((warning) => warning.includes("Subtotal + VAT")));
    assert.equal(duplicate?.invoiceId, "invoice-1");
    assert.equal(sameFile?.invoiceId, "invoice-1");
    assert.equal(differentDate, null);
  });

  it("reads native PDF text and does not invent image lines", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Supplier: Pyramid Display Materials", { x: 40, y: 760, size: 12, font });
    page.drawText("Invoice number: PY-2041", { x: 40, y: 740, size: 12, font });
    const bytes = await pdf.save();
    const text = await extractPdfText(bytes);

    assert.match(text, /Pyramid Display Materials/);
    assert.match(text, /PY-2041/);

    const imageDraft = buildInvoiceDraft({
      text: null,
      extractionStatus: "needs_ocr",
      extractionWarnings: ["This is an image invoice."],
      suppliers,
      aliases,
      products: [pyramidProduct],
      mappings: [],
      ignoreRules: [],
    });

    assert.equal(imageDraft.lines.length, 0);
    assert.equal(imageDraft.processingStatus, "extraction_error");
  });

  it("has no price write, Gmail client, or material creation in the invoice workflow", async () => {
    const files = [
      "lib/materials/invoices/actions.ts",
      "lib/materials/invoices/queries.ts",
      "lib/materials/invoices/draft.ts",
      "lib/materials/invoices/match.ts",
      "app/api/admin/materials/invoices/route.ts",
      "app/admin/materials/invoices/page.tsx",
      "app/admin/materials/invoices/[id]/page.tsx",
      "components/materials/invoice-review-panel.tsx",
    ];
    const sources = await Promise.all(
      files.map((file) => readFile(new URL(`../../../${file}`, import.meta.url), "utf8"))
    );
    const combined = sources.join("\n");

    assert.doesNotMatch(combined, /gmail|googleapis/i);
    assert.doesNotMatch(combined, /from\("material_prices"\)[\s\S]{0,120}\.(insert|update|delete|upsert)/);
    assert.doesNotMatch(sources[0], /material_prices/);
    assert.doesNotMatch(combined, /createMaterialRecord/);
    assert.match(combined, /material_prices/);
    assert.match(sources[1], /\.from\("material_prices"\)/);
    assert.match(sources[1], /\.select\(/);
  });
});
