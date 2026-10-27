import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { findDuplicateInvoice } from "@/lib/materials/invoices/duplicate";
import { buildInvoiceDraft } from "@/lib/materials/invoices/draft";
import { extractPdfText, joinPositionedText } from "@/lib/materials/invoices/extract";
import { historicalPriceDecision } from "@/lib/materials/invoices/historical-price";
import { classifyInvoiceLine } from "@/lib/materials/invoices/match";
import type { InvoiceMatchProduct } from "@/lib/materials/invoices/model";
import { parseInvoiceText } from "@/lib/materials/invoices/parse";
import { resolveInvoiceSupplier } from "@/lib/materials/invoices/supplier";

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
    assert.equal(probable.matchMethod, "specification");
    assert.equal(probable.matchedProductId, "foam-10");
    assert.match(probable.note ?? "", /not an exact supplier SKU match/);
    assert.equal(fuzzy.reviewStatus, "unmatched");
    assert.equal(fuzzy.matchConfidence, null);
    assert.equal(fuzzy.matchMethod, null);
    assert.equal(fuzzy.matchedProductId, null);
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

  it("reads an Antalis invoice number and tax date from the invoice label", () => {
    const parsed = parseInvoiceText("Antalis Ltd\ninvoice: 6701468943\ntax date: 14.08.2026\nBoard 1 sheet 10.00 10.00");

    assert.equal(parsed.invoiceNumber, "6701468943");
    assert.equal(parsed.invoiceDate, "2026-08-14");
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

  it("parses a Pyramid sales invoice from the pdfjs text layout", async () => {
    const text = await readFile(
      new URL("./fixtures/pyramid-lcan01.txt", import.meta.url),
      "utf8"
    );
    const draft = buildInvoiceDraft({
      text,
      extractionStatus: "extracted",
      suppliers,
      aliases: [
        ...aliases,
        {
          supplierId: "pyramid",
          alias: "Pyramid Display Materials Ltd.",
          normalizedAlias: "pyramid display materials ltd.",
        },
      ],
      products: [
        {
          id: "sigwhite-eco",
          supplierId: "pyramid",
          sku: null,
          description:
            "3mm 1500x3050mm SigWhite Eco DigMatt/Primer (0.15) Easy Release (Digital) PQ 60 (FG-04401)",
          materialName: "Dibond SigWhite Eco 3mm 1500mm x 3050mm",
          purchaseUnit: "sheet",
          thicknessMm: 3,
          colour: "White",
          widthMm: 1500,
          heightMm: 3050,
          lengthMm: null,
          currentPrice: 41.15,
          currentPriceUnit: "sheet",
        },
        {
          id: "foam-3",
          supplierId: "pyramid",
          sku: null,
          description: "3mm 1220x2440mm White P/E Foamalite Xpress Foam PVC (PQ200)",
          materialName: "Foamalite 3mm PVC 2440mm x 1220mm",
          purchaseUnit: "sheet",
          thicknessMm: 3,
          colour: "White",
          widthMm: 1220,
          heightMm: 2440,
          lengthMm: null,
          currentPrice: 16.15,
          currentPriceUnit: "sheet",
        },
        {
          id: "foam-5",
          supplierId: "pyramid",
          sku: null,
          description: "5mm 1220x2440mm White P/E Foamalite Xpress Foam PVC (PQ120)",
          materialName: "Foamalite 5mm PVC 2440mm x 1220mm",
          purchaseUnit: "sheet",
          thicknessMm: 5,
          colour: "White",
          widthMm: 1220,
          heightMm: 2440,
          lengthMm: null,
          currentPrice: 25.99,
          currentPriceUnit: "sheet",
        },
        {
          id: "briteline-removable",
          supplierId: "pyramid",
          sku: null,
          description:
            "Briteline MT WHT GB Removable 1370mm x 50m Monomeric Vinyl - Grey Adhesive (BLMVMWRG1370)",
          materialName: "Briteline Greyback Removable 1370mm x 50m",
          purchaseUnit: "roll",
          thicknessMm: null,
          colour: null,
          widthMm: 1370,
          heightMm: null,
          lengthMm: 50000,
          currentPrice: 89.11,
          currentPriceUnit: "roll",
        },
      ],
      mappings: [],
      ignoreRules: [],
    });

    assert.equal(draft.rawSupplierName, "Pyramid Display Materials Ltd.");
    assert.equal(draft.supplierId, "pyramid");
    assert.equal(draft.invoiceNumber, "SI1314778");
    assert.equal(draft.invoiceDate, "2026-09-29");
    assert.equal(draft.subtotal, 765.45);
    assert.equal(draft.vat, 153.09);
    assert.equal(draft.total, 918.54);
    assert.equal(draft.lines.length, 4);
    assert.deepEqual(
      draft.lines.map((line) => ({
        sku: line.rawSupplierSku,
        quantity: line.rawQuantity,
        unit: line.rawUnit,
        unitPrice: line.rawUnitPrice,
        tax: line.rawTax,
        total: line.rawLineTotal,
        status: line.reviewStatus,
        product: line.matchedProductId,
        confidence: line.matchConfidence,
      })),
      [
        {
          sku: "BLMV137MWPC",
          quantity: 1,
          unit: "Roll",
          unitPrice: 89.1,
          tax: 20,
          total: 89.1,
          status: "unmatched",
          product: null,
          confidence: null,
        },
        {
          sku: "ALUED33044",
          quantity: 5,
          unit: "SHEET",
          unitPrice: 41.15,
          tax: 20,
          total: 205.75,
          status: "processed",
          product: "sigwhite-eco",
          confidence: "high",
        },
        {
          sku: "FLXP32412PE",
          quantity: 5,
          unit: "SHEET",
          unitPrice: 16.15,
          tax: 20,
          total: 80.75,
          status: "processed",
          product: "foam-3",
          confidence: "high",
        },
        {
          sku: "FLXP52412PE",
          quantity: 15,
          unit: "SHEET",
          unitPrice: 25.99,
          tax: 20,
          total: 389.85,
          status: "processed",
          product: "foam-5",
          confidence: "high",
        },
      ]
    );
    assert.match(draft.lines[0]?.rawDescription ?? "", /Permanent 1370mm x 50m/);
    assert.match(draft.lines[0]?.rawDescription ?? "", /BLMVMWPC1370/);
    assert.match(draft.lines[1]?.rawDescription ?? "", /FG-04401/);
    assert.match(draft.lines[2]?.rawDescription ?? "", /PQ200/);
    assert.match(draft.lines[3]?.rawDescription ?? "", /PQ120/);
    assert.equal(
      draft.warnings.some((warning) => warning.includes("Subtotal + VAT") || warning.includes("line totals")),
      false
    );
  });

  it("parses Pyramid unit prices with three decimal places and keeps penny comparison", async () => {
    const text = await readFile(
      new URL("./fixtures/pyramid-three-decimal-prices.txt", import.meta.url),
      "utf8"
    );
    const draft = buildInvoiceDraft({
      text,
      extractionStatus: "extracted",
      suppliers,
      aliases: [
        ...aliases,
        {
          supplierId: "pyramid",
          alias: "Pyramid Display Materials Ltd.",
          normalizedAlias: "pyramid display materials ltd.",
        },
      ],
      products: [
        {
          id: "briteline-greyback",
          supplierId: "pyramid",
          sku: null,
          description:
            "Briteline MT WHT GB Removable 1370mm x 50m Monomeric Vinyl - Grey Adhesive (BLMVMWRG1370)",
          materialName: "Briteline Greyback Removable 1370mm x 50m",
          purchaseUnit: "roll",
          thicknessMm: null,
          colour: "White",
          widthMm: 1370,
          heightMm: null,
          lengthMm: 50000,
          currentPrice: 89.11,
          currentPriceUnit: "roll",
        },
        {
          id: "swedboard-premium",
          supplierId: "pyramid",
          sku: null,
          description:
            "16mm 1600 x 3200mm Swedboard Fibre Premium Structured Paper Board (PQ 65) FSC Mix Credit",
          materialName: "Swedboard 16mm 1600mm x 3200mm Premium",
          purchaseUnit: "sheet",
          thicknessMm: 16,
          colour: null,
          widthMm: 1600,
          heightMm: 3200,
          lengthMm: null,
          currentPrice: 58.968,
          currentPriceUnit: "sheet",
        },
        {
          id: "bubble",
          supplierId: "pyramid",
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
      mappings: [],
      ignoreRules: [],
    });

    assert.equal(draft.invoiceNumber, "SI1315538");
    assert.equal(draft.invoiceDate, "2026-10-01");
    assert.equal(draft.subtotal, 699.12);
    assert.equal(draft.vat, 139.82);
    assert.equal(draft.total, 838.94);
    assert.equal(draft.lines.length, 3);
    assert.deepEqual(
      draft.lines.map((line) => ({
        sku: line.rawSupplierSku,
        quantity: line.rawQuantity,
        unit: line.rawUnit,
        unitPrice: line.rawUnitPrice,
        total: line.rawLineTotal,
        status: line.reviewStatus,
        product: line.matchedProductId,
      })),
      [
        {
          sku: "BLMV137MWRG",
          quantity: 3,
          unit: "Roll",
          unitPrice: 89.107,
          total: 267.32,
          status: "processed",
          product: "briteline-greyback",
        },
        {
          sku: "SWBP-W/F-61632",
          quantity: 7,
          unit: "SHEET",
          unitPrice: 58.969,
          total: 412.78,
          status: "processed",
          product: "swedboard-premium",
        },
        {
          sku: "BUBBS15",
          quantity: 1,
          unit: "Roll",
          unitPrice: 19.02,
          total: 19.02,
          status: "processed",
          product: "bubble",
        },
      ]
    );
    assert.match(draft.lines[0]?.rawDescription ?? "", /Grey Adhesive/);
    assert.match(draft.lines[0]?.rawDescription ?? "", /BLMVMWRG1370/);
    assert.match(draft.lines[1]?.rawDescription ?? "", /FSC Mix Credit/);
    assert.equal(
      draft.warnings.some((warning) => warning.includes("line totals") || warning.includes("Subtotal + VAT")),
      false
    );
    assert.equal(draft.lines.some((line) => line.reviewStatus === "price_change"), false);
  });

  it("reads All Print Supplies identity, columns, and slit lines without matching another width", async () => {
    const text = await readFile(
      new URL("./fixtures/all-print-quantity-lines.txt", import.meta.url),
      "utf8"
    );
    const fromWebsite = resolveInvoiceSupplier(
      null,
      "Candid Creative Ltd\nwww.allprint.co.uk",
      suppliers,
      aliases
    );
    const fromSales = resolveInvoiceSupplier(null, "sales@allprint.co.uk", suppliers, aliases);
    const fromLegalName = resolveInvoiceSupplier(
      null,
      "all print supplies ltd.",
      suppliers,
      aliases
    );
    const fromApsToken = resolveInvoiceSupplier(null, "APS products remain the property of APS", suppliers, aliases);
    const labeledAps = resolveInvoiceSupplier("APS", "accounts@allprint.co.uk", suppliers, aliases);
    const draft = buildInvoiceDraft({
      text,
      extractionStatus: "extracted",
      suppliers,
      aliases,
      products: [
        {
          id: "pyramid-ww300-1371",
          supplierId: "pyramid",
          sku: "WW300",
          description: "WW300 MATT WHITE 50M X 1371MM",
          materialName: "WW300 Matt White 1371mm x 50m",
          purchaseUnit: "roll",
          thicknessMm: null,
          colour: "White",
          widthMm: 1371,
          heightMm: null,
          lengthMm: 50000,
          currentPrice: 298.62,
          currentPriceUnit: "roll",
        },
        {
          id: "aps-ww300-1371",
          supplierId: "all-print",
          sku: "WW300",
          description: "WW300 MATT WHITE 50M X 1371MM",
          materialName: "WW300 Matt White 1371mm x 50m",
          purchaseUnit: "roll",
          thicknessMm: null,
          colour: "White",
          widthMm: 1371,
          heightMm: null,
          lengthMm: 50000,
          currentPrice: 300,
          currentPriceUnit: "roll",
        },
        {
          id: "aps-su3-1560",
          supplierId: "all-print",
          sku: "SU3-70",
          description: "SU3-70 SEMI-MATT UV SEAL 50M X 1560MM",
          materialName: "SU3-70 Semi-matt UV Laminate 1560mm x 50m",
          purchaseUnit: "roll",
          thicknessMm: null,
          colour: null,
          widthMm: 1560,
          heightMm: null,
          lengthMm: 50000,
          currentPrice: 141.39,
          currentPriceUnit: "roll",
        },
      ],
      mappings: [],
      ignoreRules: [],
    });

    assert.equal(fromWebsite.supplierId, "all-print");
    assert.equal(fromSales.supplierId, "all-print");
    assert.equal(fromLegalName.supplierId, "all-print");
    assert.equal(fromApsToken.supplierId, null);
    assert.equal(labeledAps.supplierId, null);
    assert.match(labeledAps.warning ?? "", /not treated as All Print Supplies/);
    assert.equal(draft.supplierId, "all-print");
    assert.equal(draft.supplierName, "All Print Supplies");
    assert.equal(draft.rawSupplierName, "accounts@allprint.co.uk");
    assert.equal(draft.invoiceNumber, "146237");
    assert.equal(draft.invoiceDate, "2026-10-07");
    assert.equal(draft.subtotal, 728.06);
    assert.equal(draft.vat, 145.61);
    assert.equal(draft.total, 873.67);
    assert.equal(draft.lines.length, 3);
    assert.deepEqual(
      draft.lines.map((line) => ({
        sku: line.rawSupplierSku,
        description: line.rawDescription,
        quantity: line.rawQuantity,
        unit: line.rawUnit,
        unitPrice: line.rawUnitPrice,
        total: line.rawLineTotal,
        status: line.reviewStatus,
        product: line.matchedProductId,
        comparison: line.comparison,
      })),
      [
        {
          sku: "WW300",
          description: "WW300 MATT WHITE 50M X 1524MM",
          quantity: 1,
          unit: "roll",
          unitPrice: 332.25,
          total: 332.25,
          status: "needs_review",
          product: null,
          comparison: null,
        },
        {
          sku: "SU3-70",
          description: "SU3-70 SEMI-MATT UV SEAL 50M X 1560MM SLIT TO 1510MM",
          quantity: 1,
          unit: "roll",
          unitPrice: 141.39,
          total: 141.39,
          status: "needs_review",
          product: null,
          comparison: null,
        },
        {
          sku: "SU3-70",
          description:
            "SU3-70 SEMI-MATT UV SEAL 50M X 1560MM BOTH SLIT TO 1350MM PRICE DUE TO STOCK",
          quantity: 2,
          unit: "roll",
          unitPrice: 127.21,
          total: 254.42,
          status: "needs_review",
          product: null,
          comparison: null,
        },
      ]
    );
    assert.match(draft.lines[0]?.note ?? "", /width does not match/);
    assert.match(draft.lines[1]?.note ?? "", /width does not match/);
    assert.match(draft.lines[2]?.note ?? "", /width does not match/);
    assert.equal(draft.lines.some((line) => line.matchedProductId === "pyramid-ww300-1371"), false);
    assert.equal(draft.lines.some((line) => line.reviewStatus === "processed"), false);
    assert.equal(draft.lines.some((line) => line.reviewStatus === "price_change"), false);
    assert.equal(
      draft.warnings.some((warning) => warning.includes("line totals") || warning.includes("Subtotal + VAT")),
      false
    );
    assert.equal(joinPositionedText([
      { text: "INVOICE DATE", x: 137, y: 594 },
      { text: "INVOICE No.", x: 79, y: 594 },
      { text: "SALES ORDER No. DESPATCH DATE", x: 378, y: 594 },
      { text: "ACCOUNT No.", x: 204, y: 594 },
      { text: "CUST. ORDER No.", x: 269, y: 594 },
      { text: "06/10/2026", x: 461, y: 575 },
      { text: "146237", x: 82, y: 575 },
      { text: "170505", x: 396, y: 575 },
      { text: "07/10/2026", x: 140, y: 575 },
      { text: "VBL", x: 309, y: 575 },
      { text: "CZ500", x: 215, y: 575 },
      { text: "2", x: 110, y: 455 },
      { text: "254.42", x: 457, y: 455 },
      { text: "S", x: 501, y: 455 },
      { text: "SU3-70 SEMI-MATT UV SEAL 50M X 1560MM", x: 125, y: 455 },
      { text: "127.21", x: 388, y: 454 },
    ]), [
      "INVOICE No. INVOICE DATE ACCOUNT No. CUST. ORDER No. SALES ORDER No. DESPATCH DATE",
      "146237 07/10/2026 CZ500 VBL 170505 06/10/2026",
      "2 SU3-70 SEMI-MATT UV SEAL 50M X 1560MM 127.21 254.42 S",
    ].join("\n"));
  });

  it("does not suggest Dibond for the Foamalite lines on SI1297356", () => {
    const dibond: InvoiceMatchProduct = {
      id: "pyr-dib-3",
      supplierId: "pyramid",
      sku: "PYR-DIB-3",
      description: "TEST 3mm Dibond sheet",
      materialName: "Test Material — 3mm Dibond",
      purchaseUnit: "sheet",
      thicknessMm: 3,
      colour: "White",
      widthMm: 3050,
      heightMm: 1500,
      lengthMm: null,
      currentPrice: 64.8,
      currentPriceUnit: "sheet",
    };
    const sameSizeDibond: InvoiceMatchProduct = {
      ...dibond,
      id: "dibond-same-size",
      widthMm: 3050,
      heightMm: 1560,
    };
    const foam5: InvoiceMatchProduct = {
      id: "pyr-foam-5",
      supplierId: "pyramid",
      sku: "PYR-FOAM-5",
      description: "TEST 5mm Foamalite PVC sheet",
      materialName: "Test Material — 5mm Foamalite PVC",
      purchaseUnit: "sheet",
      thicknessMm: 5,
      colour: "White",
      widthMm: 2440,
      heightMm: 1220,
      lengthMm: null,
      currentPrice: 41.2,
      currentPriceUnit: "sheet",
    };
    const compatibleFoam5: InvoiceMatchProduct = {
      ...foam5,
      id: "foam-5-3050",
      description: "5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC",
      materialName: "Foamalite 5mm PVC 3050mm x 1560mm",
      widthMm: 3050,
      heightMm: 1560,
    };
    const line1 = {
      lineNumber: 1,
      rawDescription: "3mm 3050x1560mm White P/E Foamalite Xpress Foam PVC (PQ120)",
      rawSupplierSku: "FLXP33015PE",
      rawQuantity: 7,
      rawUnit: "SHEET",
      rawUnitPrice: 25.479,
      rawLineTotal: 178.35,
      rawTax: null,
    };
    const line2 = {
      lineNumber: 2,
      rawDescription: "5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC (PQ80)",
      rawSupplierSku: "FLXP53015PE",
      rawQuantity: 7,
      rawUnit: "SHEET",
      rawUnitPrice: 41.753,
      rawLineTotal: 292.27,
      rawTax: null,
    };
    const wrongFamily = classifyInvoiceLine({
      line: line1,
      supplierId: "pyramid",
      products: [dibond, sameSizeDibond, foam5],
      mappings: [],
      ignoreRules: [],
    });
    const differentSize = classifyInvoiceLine({
      line: line2,
      supplierId: "pyramid",
      products: [dibond, foam5],
      mappings: [],
      ignoreRules: [],
    });
    const compatible = classifyInvoiceLine({
      line: line2,
      supplierId: "pyramid",
      products: [dibond, sameSizeDibond, foam5, compatibleFoam5],
      mappings: [],
      ignoreRules: [],
    });
    const exactSku = classifyInvoiceLine({
      line: line2,
      supplierId: "pyramid",
      products: [{ ...compatibleFoam5, id: "exact-sku", sku: "FLXP53015PE" }, dibond],
      mappings: [],
      ignoreRules: [],
    });
    const families = ["Foamalite", "Dibond", "acrylic", "vinyl", "banner", "paper", "fabric"].map(
      (family): InvoiceMatchProduct => ({
        id: family.toLowerCase(),
        supplierId: "pyramid",
        sku: `TEST-${family.toUpperCase()}`,
        description: `3mm 1220x2440mm White ${family} sheet`,
        materialName: `Test ${family}`,
        purchaseUnit: "sheet",
        thicknessMm: 3,
        colour: "White",
        widthMm: 1220,
        heightMm: 2440,
        lengthMm: null,
        currentPrice: 10,
        currentPriceUnit: "sheet",
      })
    );
    const acrylicLine = classifyInvoiceLine({
      line: {
        ...line1,
        rawDescription: "3mm 1220x2440mm White acrylic sheet",
        rawSupplierSku: "ACR-3",
      },
      supplierId: "pyramid",
      products: families,
      mappings: [],
      ignoreRules: [],
    });

    assert.equal(wrongFamily.matchedProductId, null);
    assert.equal(wrongFamily.matchConfidence, null);
    assert.equal(wrongFamily.matchMethod, null);
    assert.equal(wrongFamily.reviewStatus, "unmatched");
    assert.equal(differentSize.matchedProductId, null);
    assert.equal(differentSize.reviewStatus, "unmatched");
    assert.equal(compatible.matchedProductId, "foam-5-3050");
    assert.equal(compatible.matchMethod, "specification");
    assert.equal(compatible.matchConfidence, "medium");
    assert.equal(compatible.reviewStatus, "needs_review");
    assert.match(compatible.note ?? "", /not an exact supplier SKU match/);
    assert.equal(exactSku.matchedProductId, "exact-sku");
    assert.equal(exactSku.matchMethod, "sku");
    assert.equal(exactSku.matchConfidence, "high");
    assert.equal(acrylicLine.matchedProductId, "acrylic");
    assert.equal(acrylicLine.matchMethod, "specification");
    assert.notEqual(acrylicLine.matchedProductId, "dibond");
  });

  it("has no price write, Gmail client, or material creation in the invoice workflow", async () => {
    const files = [
      "lib/materials/invoices/actions.ts",
      "lib/materials/invoices/reprocess.ts",
      "lib/materials/invoices/queries.ts",
      "lib/materials/invoices/draft.ts",
      "lib/materials/invoices/match.ts",
      "app/api/admin/materials/invoices/route.ts",
      "app/admin/materials/invoices/page.tsx",
      "app/admin/materials/invoices/[id]/page.tsx",
      "components/materials/invoice-review-panel.tsx",
      "lib/materials/invoices/reprocess-guard.ts",
    ];
    const sources = await Promise.all(
      files.map((file) => readFile(new URL(`../../../${file}`, import.meta.url), "utf8"))
    );
    const combined = sources.join("\n");
    const pipeline = sources.filter(
      (_, index) => files[index] !== "app/admin/materials/invoices/page.tsx"
    );

    assert.doesNotMatch(pipeline.join("\n"), /googleapis|gmail\.users|gmail\.readonly|@\/lib\/gmail/i);
    assert.match(sources[6], /\/admin\/materials\/invoices\/gmail/);
    assert.doesNotMatch(combined, /from\("material_prices"\)[\s\S]{0,120}\.(insert|update|delete|upsert)/);
    assert.doesNotMatch(sources[0], /material_prices/);
    assert.doesNotMatch(sources[1], /material_prices/);
    assert.doesNotMatch(combined, /createMaterialRecord/);
    assert.match(combined, /material_prices/);
    assert.match(sources[2], /\.from\("material_prices"\)/);
    assert.match(sources[2], /\.select\(/);
    assert.match(sources[sources.length - 1], /\.from\("material_prices"\)/);
    assert.doesNotMatch(sources[sources.length - 1], /\.(insert|update|delete|upsert)\(/);
  });

  it("reads All Print invoice numbers when the order reference is blank or has several words", () => {
    const header =
      "INVOICE No. INVOICE DATE ACCOUNT No. CUST. ORDER No. SALES ORDER No. DESPATCH DATE";
    const severalWords = parseInvoiceText(
      `${header}\n144944 28/09/2026 CZ500 VBL DAN 169278 25/09/2026\n`
    );
    const blankOrder = parseInvoiceText(
      `${header}\n144599 24/09/2026 CZ500 168959 23/09/2026\n`
    );

    assert.equal(severalWords.invoiceNumber, "144944");
    assert.equal(severalWords.invoiceDate, "2026-09-28");
    assert.equal(blankOrder.invoiceNumber, "144599");
    assert.equal(blankOrder.invoiceDate, "2026-09-24");
  });

  it("checks the five All Print pilot invoices without assigning an ambiguous width or hiding a price difference", () => {
    const su31350: InvoiceMatchProduct = {
      id: "su3-1350",
      supplierId: "all-print",
      sku: "SU3-70",
      description: "SU3-70 SEMI-MATT UV SEAL 50M X 1350MM",
      materialName: "SU3-70 Semi-matt UV Laminate 1350mm x 50m",
      purchaseUnit: "roll",
      thicknessMm: null,
      colour: null,
      widthMm: 1350,
      heightMm: null,
      lengthMm: 50000,
      currentPrice: 127.21,
      currentPriceUnit: "roll",
      currentPriceId: "price-su3-1350",
      currentEffectiveDate: "2026-10-01",
    };
    const su31560: InvoiceMatchProduct = {
      ...su31350,
      id: "su3-1560",
      description: "SU3-70 SEMI-MATT UV SEAL 50M X 1560MM",
      materialName: "SU3-70 Semi-matt UV Laminate 1560mm x 50m",
      widthMm: 1560,
      currentPrice: 127.21,
      currentPriceId: "price-su3-1560",
    };
    const products: InvoiceMatchProduct[] = [
      su31350,
      su31560,
      {
        id: "easydot",
        supplierId: "all-print",
        sku: null,
        description: "SOLVOPRINT DOT MATT WHITE 50 X 1372",
        materialName: "Easydot Matt White 1372mm x 50m",
        purchaseUnit: "roll",
        thicknessMm: null,
        colour: "White",
        widthMm: 1372,
        heightMm: null,
        lengthMm: 50000,
        currentPrice: 194.16,
        currentPriceUnit: "roll",
        currentPriceId: "price-easydot",
        currentEffectiveDate: "2026-10-01",
      },
      {
        id: "m16-permanent",
        supplierId: "all-print",
        sku: null,
        description: "M16-P-P MT WH HOP PERM PE 50 X 1370",
        materialName: "Nucoat M16 Permanent White 1370mm x 50m",
        purchaseUnit: "roll",
        thicknessMm: null,
        colour: "White",
        widthMm: 1370,
        heightMm: null,
        lengthMm: 50000,
        currentPrice: 129.85,
        currentPriceUnit: "roll",
        currentPriceId: "price-m16p",
        currentEffectiveDate: "2026-10-01",
      },
      {
        id: "m16-high",
        supplierId: "all-print",
        sku: null,
        description: "M16-H-P MT WH HIGH PE 50 X 1370",
        materialName: "Nucoat M16 High Tack White 1370mm x 50m",
        purchaseUnit: "roll",
        thicknessMm: null,
        colour: "White",
        widthMm: 1370,
        heightMm: null,
        lengthMm: 50000,
        currentPrice: 266.18,
        currentPriceUnit: "roll",
        currentPriceId: "price-m16h",
        currentEffectiveDate: "2026-10-01",
      },
      {
        id: "p65w",
        supplierId: "all-print",
        sku: null,
        description: "P65W SILVER CRYSTAL 1600MM",
        materialName: "P65W Silver Crystal 1600mm",
        purchaseUnit: "linear_metre",
        thicknessMm: null,
        colour: null,
        widthMm: 1600,
        heightMm: null,
        lengthMm: null,
        currentPrice: 11.19,
        currentPriceUnit: "linear_metre",
        currentPriceId: "price-p65",
        currentEffectiveDate: "2026-10-01",
      },
      {
        id: "conform",
        supplierId: "all-print",
        sku: null,
        description: "4075 CONFORM 100YDS X 1220MM",
        materialName: "Conform 4075 Application Tape 1220mm",
        purchaseUnit: "roll",
        thicknessMm: null,
        colour: null,
        widthMm: 1220,
        heightMm: null,
        lengthMm: 91440,
        currentPrice: 111.5,
        currentPriceUnit: "roll",
        currentPriceId: "price-conform",
        currentEffectiveDate: "2026-10-01",
      },
    ];
    const invoice = (numberLine: string, lines: string[]) =>
      [
        "All Print Supplies Ltd",
        "INVOICE No. INVOICE DATE ACCOUNT No. CUST. ORDER No. SALES ORDER No. DESPATCH DATE",
        numberLine,
        "QUANTITY DESCRIPTION UNIT PRICE LINE VALUE VAT",
        ...lines,
      ].join("\n");
    const draftFor = (numberLine: string, lines: string[]) =>
      buildInvoiceDraft({
        text: invoice(numberLine, lines),
        extractionStatus: "extracted",
        suppliers,
        aliases,
        products,
        mappings: [],
        ignoreRules: [],
      });
    const summary = (numberLine: string, lines: string[]) =>
      draftFor(numberLine, lines).lines.map((line) => ({
        unit: line.rawUnit,
        price: line.rawUnitPrice,
        status: line.reviewStatus,
        product: line.matchedProductId,
      }));

    const easydot = draftFor("135602 13/07/2026 CZ500 Dan 159753 10/07/2026", [
      "1 SOLVOPRINT DOT MATT WHITE 50 X 1372 194.16 194.16 S",
    ]);
    assert.equal(easydot.invoiceNumber, "135602");
    assert.deepEqual(summary("135602 13/07/2026 CZ500 Dan 159753 10/07/2026", [
      "1 SOLVOPRINT DOT MATT WHITE 50 X 1372 194.16 194.16 S",
    ]), [{ unit: "roll", price: 194.16, status: "processed", product: "easydot" }]);
    assert.deepEqual(summary("137616 29/07/2026 CZ500 Dan 161914 28/07/2026", [
      "4 SU3-70 SEMI-MATT UV SEAL 50M X 1350MM 127.21 508.84 S",
      "2 M16-P-P MT WH HOP PERM PE 50 X 1370 126.07 252.14 S",
    ]), [
      { unit: "roll", price: 127.21, status: "processed", product: "su3-1350" },
      { unit: "roll", price: 126.07, status: "price_change", product: "m16-permanent" },
    ]);
    const highTack = draftFor("138266 04/08/2026 CZ500 Dan 161915 28/07/2026", [
      "1 M16-H-P MT WH HIGH PE 50 X 1370 258.43 258.43 S",
    ]);
    assert.deepEqual(summary("138266 04/08/2026 CZ500 Dan 161915 28/07/2026", [
      "1 M16-H-P MT WH HIGH PE 50 X 1370 258.43 258.43 S",
    ]), [{ unit: "roll", price: 258.43, status: "price_change", product: "m16-high" }]);
    assert.deepEqual(summary("142960 11/09/2026 CZ500 VBL 167189 10/09/2026", [
      "50 P65W SILVER CRYSTAL 1600MM 11.19 559.50 S",
      "1 4075 CONFORM 100YDS X 1220MM 111.50 111.50 S",
    ]), [
      { unit: "linear_metre", price: 11.19, status: "processed", product: "p65w" },
      { unit: "roll", price: 111.5, status: "processed", product: "conform" },
    ]);
    assert.deepEqual(summary("145275 30/09/2026 CZ500 VBL 169687 29/09/2026", [
      "2 M16-P-P MT WH HOP PERM PE 50 X 1370 129.85 259.70 S",
    ]), [{ unit: "roll", price: 129.85, status: "processed", product: "m16-permanent" }]);

    const ambiguous = draftFor("139000 01/08/2026 CZ500 Dan 100 02/08/2026", [
      "1 SU3-70 SEMI-MATT UV SEAL 127.21 127.21 S",
    ]);
    assert.equal(ambiguous.lines[0]?.matchedProductId, null);
    assert.equal(ambiguous.lines[0]?.reviewStatus === "processed", false);
    assert.equal(ambiguous.lines[0]?.reviewStatus === "price_change", false);

    const pricedByWidth = historicalPriceDecision({
      extractionStatus: "extracted",
      invoiceDate: highTack.invoiceDate,
      supplierId: "all-print",
      line: highTack.lines[0],
      product: products.find((item) => item.id === "m16-high") ?? null,
      productActive: true,
      supplierProducts: products,
      mappings: [],
      prices: [
        {
          id: "price-m16h",
          price: 266.18,
          priceUnit: "roll",
          effectiveDate: "2026-10-01",
          approvedAt: "2026-10-01T00:00:00.000Z",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
    assert.equal(pricedByWidth.retain, false);
    assert.equal("code" in pricedByWidth ? pricedByWidth.code : "", "sku");
  });

  it("reads Antalis, PPB and Papergraphics layouts without guessing a unit or a product", () => {
    const catalogueSuppliers = [
      ...suppliers,
      { id: "ppb", name: "PPB", normalizedName: "ppb" },
      { id: "papergraphics", name: "Papergraphics", normalizedName: "papergraphics" },
    ];
    const products: InvoiceMatchProduct[] = [
      {
        id: "foam-5mm",
        supplierId: "antalis",
        sku: null,
        description: "Foamalite, XPRESS, Filmed, white 5.000mm 1220mm x 2440mm",
        materialName: "Foamalite 5mm 1220 x 2440",
        purchaseUnit: "sheet",
        thicknessMm: 5,
        colour: "White",
        widthMm: 1220,
        heightMm: 2440,
        lengthMm: null,
        currentPrice: 23.35,
        currentPriceUnit: "sheet",
        currentPriceId: "price-foam",
        currentEffectiveDate: "2026-10-01",
      },
      {
        id: "correx-4mm",
        supplierId: "antalis",
        sku: null,
        description: "Correx®, White, matt, Long Flute, White 4.000mm 1524mm x 3050mm",
        materialName: "Correx 4mm 1524 x 3050",
        purchaseUnit: "sheet",
        thicknessMm: 4,
        colour: "White",
        widthMm: 1524,
        heightMm: 3050,
        lengthMm: null,
        currentPrice: 12,
        currentPriceUnit: "sheet",
        currentPriceId: "price-correx",
        currentEffectiveDate: "2026-10-01",
      },
      {
        id: "bubble",
        supplierId: "antalis",
        sku: null,
        description: "Air Bubble Film, Jiffy Small Bubble Wrap 1500 mm x 100.00 m, 1 ply, Clear, 1 reel",
        materialName: "Jiffy bubble wrap 1500mm",
        purchaseUnit: "roll",
        thicknessMm: null,
        colour: "Clear",
        widthMm: 1500,
        heightMm: null,
        lengthMm: 100000,
        currentPrice: 33.29,
        currentPriceUnit: "roll",
        currentPriceId: "price-bubble",
        currentEffectiveDate: "2026-10-01",
      },
      {
        id: "hips-2440",
        supplierId: "ppb",
        sku: null,
        description: "WHITE 7231 GLOSS/MATT HIPS WITH FILM (ON GLOSS SIDE) 1MM BULK PACK 2440mm x 1220mm",
        materialName: "HIPS 1mm 2440 x 1220",
        purchaseUnit: "sheet",
        thicknessMm: 1,
        colour: "White",
        widthMm: 2440,
        heightMm: 1220,
        lengthMm: null,
        currentPrice: 26,
        currentPriceUnit: "sheet",
        currentPriceId: "price-hips",
        currentEffectiveDate: "2026-10-01",
      },
      {
        id: "magenta",
        supplierId: "papergraphics",
        sku: null,
        description: "HP/4UV77A No. 832 Latex Magenta Ink 1000ml",
        materialName: "HP 832 Magenta 1000ml",
        purchaseUnit: "unit",
        thicknessMm: null,
        colour: null,
        widthMm: null,
        heightMm: null,
        lengthMm: null,
        currentPrice: 95,
        currentPriceUnit: "unit",
        currentPriceId: "price-magenta",
        currentEffectiveDate: "2026-10-01",
      },
    ];
    const draftFor = (text: string) =>
      buildInvoiceDraft({
        text,
        extractionStatus: "extracted",
        suppliers: catalogueSuppliers,
        aliases,
        products,
        mappings: [],
        ignoreRules: [],
      });

    const antalis = draftFor(`Antalis Ltd
Invoice: 6701404665
Tax Date: 28.07.2026
Item Material Customer Reference Weight Quantity Unit Price Amount(GBP)
Description
Foamalite, XPRESS, Filmed, white 10.000 KG 2 SH
10 609745
5.000mm
1220mm x 2440mm
Total Net price 23.35 GBP/1 SH 46.70
Correx®, White, matt, Long Flute, White 12.000 KG 1 SH
20 608408
4.000mm
1524mm x 3050mm
Total Net price 11.21 GBP/1 SH 11.21
Air Bubble Film, Jiffy Small Bubble Wrap 9.000 KG 2 BL
30 611473
1500 mm x 100.00 m, 1 ply, Clear, 1 reel
Total Net price 33.29 GBP/1 BL 66.58
Xerox, Premium NeverTear 4.000 KG 4 PK
40 617981
Total Net price 929.84 GBP/1000 SH 371.94
Small Order Charge GBP 25.00
Total Net Amount GBP 521.43
VAT 20.00% GBP 104.29
Total Amount GBP 625.72`);

    assert.equal(antalis.supplierId, "antalis");
    assert.equal(antalis.invoiceNumber, "6701404665");
    assert.equal(antalis.invoiceDate, "2026-07-28");
    assert.equal(antalis.warnings.some((warning) => /subtotal|line totals/i.test(warning)), false);
    assert.deepEqual(
      antalis.lines.map((line) => ({
        unit: line.rawUnit,
        price: line.rawUnitPrice,
        total: line.rawLineTotal,
        status: line.reviewStatus,
        product: line.matchedProductId,
      })),
      [
        { unit: "sheet", price: 23.35, total: 46.7, status: "processed", product: "foam-5mm" },
        { unit: "sheet", price: 11.21, total: 11.21, status: "price_change", product: "correx-4mm" },
        { unit: "BL", price: 33.29, total: 66.58, status: "needs_review", product: "bubble" },
        { unit: "PK", price: null, total: 371.94, status: "needs_review", product: null },
        { unit: null, price: 25, total: 25, status: "unmatched", product: null },
      ]
    );
    assert.match(antalis.lines[2]?.note ?? "", /not recognised/);
    assert.equal(antalis.lines[3]?.reviewStatus === "processed", false);

    const priceKept = historicalPriceDecision({
      extractionStatus: "extracted",
      invoiceDate: antalis.invoiceDate,
      supplierId: "antalis",
      line: antalis.lines[1],
      product: products[1],
      productActive: true,
      supplierProducts: products,
      mappings: [],
      prices: [
        {
          id: "price-correx",
          price: 12,
          priceUnit: "sheet",
          effectiveDate: "2026-10-01",
          approvedAt: "2026-10-01T00:00:00.000Z",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
    assert.equal(priceKept.retain, false);
    assert.equal(products[1]?.currentPrice, 12);

    const duplicate = findDuplicateInvoice({
      checksumSha256: "new-file",
      supplierId: antalis.supplierId,
      invoiceNumber: antalis.invoiceNumber,
      invoiceDate: antalis.invoiceDate,
      existing: [
        {
          id: "stored-antalis",
          supplierId: "antalis",
          invoiceNumber: "6701404665",
          invoiceDate: "2026-07-28",
          checksumSha256: "older-file",
        },
      ],
    });
    assert.equal(duplicate?.invoiceId, "stored-antalis");
    const differentDate = findDuplicateInvoice({
      checksumSha256: "new-file",
      supplierId: antalis.supplierId,
      invoiceNumber: antalis.invoiceNumber,
      invoiceDate: antalis.invoiceDate,
      existing: [
        {
          id: "other-date",
          supplierId: "antalis",
          invoiceNumber: "6701404665",
          invoiceDate: "2026-08-01",
          checksumSha256: "older-file",
        },
      ],
    });
    assert.equal(differentDate, null);

    const ppb = draftFor(`PPB Sales Invoice
PPB Ltd
Invoice Number 861573
Cray Road Invoice Date 18/09/2026
Line Item Code / Product Description Quantity Price VAT Code
1 STYWH-1000-2440-1220 20 520.00 O1
WHITE 7231 GLOSS/MATT HIPS WITH FILM (ON GLOSS SIDE)
1MM BULK PACK 2440mm x 1220mm
Net £ 520.00
VAT £ 104.00
Total £ 624.00`);
    assert.equal(ppb.supplierId, "ppb");
    assert.equal(ppb.invoiceNumber, "861573");
    assert.equal(ppb.invoiceDate, "2026-09-18");
    assert.equal(ppb.lines[0]?.rawUnit, null);
    assert.equal(ppb.lines[0]?.rawUnitPrice, 26);
    assert.equal(ppb.lines[0]?.reviewStatus, "processed");
    assert.equal(ppb.lines[0]?.matchedProductId, "hips-2440");
    assert.match(ppb.lines[0]?.note ?? "", /catalogue unit/);

    const parcel = draftFor(`PPB Ltd
Invoice Number 862537
Invoice Date 08/10/2026
Line Item Code / Product Description Quantity Price VAT Code
1 PACKA-0001-0001-0001 1 0.00 O1
PACKAGE TO SEND AS PER INSTRUCTIONS
Net £ 0.00
VAT £ 0.00
Total £ 0.00`);
    assert.equal(parcel.invoiceNumber, "862537");
    assert.equal(parcel.lines[0]?.matchedProductId, null);
    assert.equal(parcel.lines[0]?.reviewStatus, "unmatched");
    assert.equal(parcel.lines[0]?.rawLineTotal, 0);

    const paper = draftFor(`Papergraphics Limited
Invoice Number: 01SI-2368836-20
Invoice: 01SI-2368836-2026
Date: 13.08.2026
Line Product Description Quantity Net Price Tax Rate Net Value
20 HP/4UV77A No. 832 Latex Magenta Ink 2 Each 95.00 GBP / 1 20 % 190.00 GBP
1000ml Each
10 HP/P2V72A Hp 730 Ink Cartridge Grey - 1 Each 130.00 GBP / 1 20 % 130.00 GBP
300ml Each
Total Item Net Value 320.00 GBP
Freight 21.81 GBP
Total 341.81 GBP`);
    assert.equal(paper.supplierId, "papergraphics");
    assert.equal(paper.invoiceNumber, "01SI-2368836-20");
    assert.equal(paper.invoiceDate, "2026-08-13");
    assert.equal(paper.subtotal, 341.81);
    assert.equal(paper.warnings.some((warning) => /line totals/i.test(warning)), false);
    assert.deepEqual(
      paper.lines.map((line) => ({
        description: line.rawDescription,
        unit: line.rawUnit,
        status: line.reviewStatus,
        product: line.matchedProductId,
      })),
      [
        {
          description: "HP/4UV77A No. 832 Latex Magenta Ink 1000ml",
          unit: "Each",
          status: "processed",
          product: "magenta",
        },
        {
          description: "HP/P2V72A Hp 730 Ink Cartridge Grey - 300ml",
          unit: "Each",
          status: "unmatched",
          product: null,
        },
        { description: "Freight", unit: null, status: "unmatched", product: null },
      ]
    );

    const flooring = parseInvoiceText(`Papergraphics Limited
Invoice Number: 01SI-2372386-20
Date: 17.09.2026
Line Product Description Quantity Net Price Tax Rate Net Value
10 DF/ Digiflor Tactile Display Flooring 4 1 Roll 336.27 GBP / 1 20 % 1,345.08 GBP
DFL1/220020/7 1 Roll
6/1
Total Item Net Value 1,345.08 GBP
Freight 108.00 GBP
Total 1,743.70 GBP`);
    assert.equal(flooring.invoiceNumber, "01SI-2372386-20");
    assert.equal(flooring.subtotal, 1453.08);
    assert.equal(flooring.warnings.some((warning) => /line totals/i.test(warning)), false);
    assert.equal(flooring.lines[0]?.rawQuantity, 4);
    assert.equal(flooring.lines[0]?.rawUnit, "Roll");
    assert.equal(flooring.lines[0]?.rawUnitPrice, 336.27);
    assert.equal(flooring.lines[0]?.rawLineTotal, 1345.08);
    assert.equal(flooring.lines[1]?.rawDescription, "Freight");
    assert.equal(flooring.lines[1]?.rawLineTotal, 108);
  });

  it("reads Innotech, Quality Print Services and BMG without creating catalogue records", () => {
    const mesh =
      "Vistaflex ML400 - PVC Mesh Banner With Liner 400 FR EN13501 - 2200mm x 50m";
    const poster =
      "KODAK Production Satin Poster Paper, 200gsm - 1524mm x 80m (SCS-COC-004532 FSC Mix Credit)";
    const catalogueSuppliers = [
      ...suppliers,
      { id: "innotech", name: "Innotech Digital & Display", normalizedName: "innotech digital & display" },
      { id: "qps", name: "Quality Print Services Ltd", normalizedName: "quality print services ltd" },
      { id: "bmg", name: "BMG Media Source UK Limited", normalizedName: "bmg media source uk limited" },
    ];
    const products: InvoiceMatchProduct[] = [
      {
        id: "mesh",
        supplierId: "innotech",
        sku: "ISB275567",
        description: mesh,
        materialName: "Vistaflex ML400",
        purchaseUnit: "roll",
        thicknessMm: null,
        colour: null,
        widthMm: 2200,
        heightMm: null,
        lengthMm: 50000,
        currentPrice: 198.66,
        currentPriceUnit: "roll",
        currentPriceId: "price-mesh",
        currentEffectiveDate: "2026-09-01",
      },
      {
        id: "poster",
        supplierId: "bmg",
        sku: null,
        description: poster,
        materialName: "Kodak satin poster",
        purchaseUnit: "roll",
        thicknessMm: null,
        colour: null,
        widthMm: 1524,
        heightMm: null,
        lengthMm: 80000,
        currentPrice: 90,
        currentPriceUnit: "roll",
        currentPriceId: "price-poster",
        currentEffectiveDate: "2026-03-01",
      },
    ];
    const draftFor = (text: string) =>
      buildInvoiceDraft({
        text,
        extractionStatus: "extracted",
        suppliers: catalogueSuppliers,
        aliases,
        products,
        mappings: [],
        ignoreRules: [],
      });
    const unknown = buildInvoiceDraft({
      text: `Innotech Digital & Display
(a trading division of Vink UK Ltd)
Invoice No: 598646
Invoice Date: 09/09/2026
Qty Code Description Price Each Line Total Line VAT
1 ISB275567 Vistaflex ML400 - PVC Mesh Banner With Liner 400 198.66 198.66 39.73
FR EN13501 - 2200mm x 50m
Delivery Net VAT % VAT
DX Overnight - Carton 35.00 20.00 7.00
End of Invoice
Total Net: 233.66
VAT Amount: 46.73
Total: 280.39`,
      extractionStatus: "extracted",
      suppliers,
      aliases,
      products: [],
      mappings: [],
      ignoreRules: [],
    });

    assert.equal(unknown.supplierId, null);
    assert.equal(unknown.rawSupplierName, "Innotech Digital & Display");
    assert.equal(unknown.lines.every((line) => line.reviewStatus !== "processed"), true);
    assert.equal(unknown.lines.every((line) => line.matchedProductId == null), true);

    const innotech = draftFor(`Innotech Digital & Display
(a trading division of Vink UK Ltd)
Invoice No: 598646
Invoice Date: 09/09/2026
Qty Code Description Price Each Line Total Line VAT
1 ISB275567 Vistaflex ML400 - PVC Mesh Banner With Liner 400 198.66 198.66 39.73
FR EN13501 - 2200mm x 50m
4 INE185586 Conquest Roller Banner - 2000mm Snap Rail 45.31 181.24 36.25
Delivery Net VAT % VAT
DX Overnight - Carton 35.00 20.00 7.00
End of Invoice
Goods Net: 380.00
Total Net: 414.90
VAT Amount: 82.98
Total: 497.88`);
    assert.equal(innotech.supplierId, "innotech");
    assert.equal(innotech.invoiceNumber, "598646");
    assert.equal(innotech.invoiceDate, "2026-09-09");
    assert.equal(innotech.subtotal, 414.9);
    assert.equal(innotech.vat, 82.98);
    assert.equal(innotech.total, 497.88);
    assert.equal(innotech.warnings.some((warning) => /line totals|subtotal \+/i.test(warning)), false);
    assert.equal(innotech.lines[0]?.rawUnit, "roll");
    assert.equal(innotech.lines[0]?.reviewStatus, "processed");
    assert.equal(innotech.lines[0]?.matchedProductId, "mesh");
    assert.equal(innotech.lines[1]?.rawUnit, null);
    assert.equal(innotech.lines[1]?.reviewStatus, "unmatched");
    assert.equal(innotech.lines[2]?.rawDescription, "DX Overnight - Carton");
    assert.equal(innotech.lines[2]?.rawLineTotal, 35);
    const sheetOnly = buildInvoiceDraft({
      text: `Innotech Digital & Display
Invoice No: 598646
Invoice Date: 09/09/2026
Qty Code Description Price Each Line Total Line VAT
1 ISB275567 Vistaflex ML400 - PVC Mesh Banner With Liner 400 198.66 198.66 39.73
FR EN13501 - 2200mm x 50m
End of Invoice
Total Net: 198.66
VAT Amount: 39.73
Total: 238.39`,
      extractionStatus: "extracted",
      suppliers: catalogueSuppliers,
      aliases,
      products: [{ ...products[0], id: "mesh-sheet", purchaseUnit: "sheet", currentPriceUnit: "sheet" }],
      mappings: [],
      ignoreRules: [],
    });
    assert.equal(sheetOnly.lines[0]?.reviewStatus, "needs_review");
    assert.match(sheetOnly.lines[0]?.note ?? "", /unit does not match/);

    const frontlit = draftFor(`Innotech Digital & Display
Invoice No: 592260
Invoice Date: 03/06/2026
Qty Code Description Price Each Line Total Line VAT
1 ISB274903 Vistaflex SC450 - Premium Frontlit PVC Banner 450 316.68 316.68 63.34
FR EN13501 - 3200mm x 65m
1 MISC337081 INNO Delivery Box 0.00 0.00 0.00
Delivery Net VAT % VAT
NEXT DAY STD 95.00 20.00 19.00
End of Invoice
Total Net: 411.68
VAT Amount: 82.34
Total: 494.02`);
    assert.equal(frontlit.invoiceNumber, "592260");
    assert.equal(frontlit.lines[0]?.rawUnit, "roll");
    assert.equal(frontlit.lines[0]?.rawLineTotal, 316.68);
    assert.equal(frontlit.lines[1]?.rawLineTotal, 0);
    assert.equal(frontlit.lines[2]?.rawLineTotal, 95);
    assert.equal(frontlit.warnings.some((warning) => /line totals/i.test(warning)), false);

    const ink = draftFor(`Quality Print Services Ltd
Invoice No.: 77366
Invoice Date: 06/07/2026
Quantity Details Unit Price Net Amount VAT Rate VAT
3.00 770 UV Yellow - 1 litre 84.45 253.35 20.00 50.67
2.00 770 UV Black - 1 litre 84.45 168.90 20.00 33.78
1.00 CARRIAGE STANDARD DELIVERY 10.00 10.00 20.00 2.00
Total VAT Amount 86.45
Invoice Total 518.70`);
    assert.equal(ink.supplierId, "qps");
    assert.equal(ink.invoiceNumber, "77366");
    assert.equal(ink.invoiceDate, "2026-07-06");
    assert.equal(ink.subtotal, 432.25);
    assert.equal(ink.lines[0]?.rawUnit, null);
    assert.equal(ink.lines[0]?.rawQuantity, 3);
    assert.equal(ink.lines[0]?.rawUnitPrice, 84.45);
    assert.equal(ink.lines[0]?.reviewStatus, "unmatched");
    assert.equal(ink.lines[2]?.rawDescription, "CARRIAGE STANDARD DELIVERY");
    assert.equal(ink.warnings.some((warning) => /line totals|subtotal \+/i.test(warning)), false);
    assert.equal(products.length, 2);

    const bmg = draftFor(`BMG Media Source UK Limited Date 6/3/2026
Tax Invoice # INVUK0007493
SKU Description Ordered Shipped Tax Rate Rate Amount
KPRDSPOS15248 KODAK Production Satin Poster 3 3 20% 100,64 301,92
0 Paper, 200gsm - 1524mm x 80m (SCS-
COC-004532 FSC Mix Credit)
Subtotal 301,92
Shipping Cost (BMG GB UPS Best Way) 60,00
Total £434,30`);
    assert.equal(bmg.supplierId, "bmg");
    assert.equal(bmg.invoiceNumber, "INVUK0007493");
    assert.equal(bmg.invoiceDate, "2026-03-06");
    assert.equal(bmg.subtotal, 361.92);
    assert.equal(bmg.vat, 72.38);
    assert.equal(bmg.total, 434.3);
    assert.equal(bmg.lines[0]?.rawDescription, poster);
    assert.equal(bmg.lines[0]?.rawQuantity, 3);
    assert.equal(bmg.lines[0]?.rawUnit, "roll");
    assert.equal(bmg.lines[0]?.rawUnitPrice, 100.64);
    assert.equal(bmg.lines[0]?.reviewStatus, "price_change");
    assert.equal(bmg.lines[1]?.rawLineTotal, 60);
    assert.equal(bmg.warnings.some((warning) => /line totals|subtotal \+/i.test(warning)), false);
    const kept = historicalPriceDecision({
      extractionStatus: "extracted",
      invoiceDate: bmg.invoiceDate,
      supplierId: "bmg",
      line: bmg.lines[0],
      product: products[1],
      productActive: true,
      supplierProducts: products,
      mappings: [],
      prices: [
        {
          id: "price-poster",
          price: 90,
          priceUnit: "roll",
          effectiveDate: "2026-03-01",
          approvedAt: "2026-03-01T00:00:00.000Z",
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    });
    assert.equal(kept.retain, false);
    assert.equal(products[1]?.currentPrice, 90);
    const duplicate = findDuplicateInvoice({
      checksumSha256: "second-copy",
      supplierId: "bmg",
      invoiceNumber: bmg.invoiceNumber,
      invoiceDate: bmg.invoiceDate,
      existing: [
        {
          id: "first-copy",
          supplierId: "bmg",
          invoiceNumber: "INVUK0007493",
          invoiceDate: "2026-03-06",
          checksumSha256: "first-copy",
        },
      ],
    });
    assert.equal(duplicate?.invoiceId, "first-copy");
  });
});
