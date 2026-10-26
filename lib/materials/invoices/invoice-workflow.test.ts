import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { findDuplicateInvoice } from "@/lib/materials/invoices/duplicate";
import { buildInvoiceDraft } from "@/lib/materials/invoices/draft";
import { extractPdfText, joinPositionedText } from "@/lib/materials/invoices/extract";
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
          unit: null,
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
          unit: null,
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
          unit: null,
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

    assert.doesNotMatch(pipeline.join("\n"), /gmail|googleapis/i);
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
});
