import { createHash } from "node:crypto";

import PDFDocument from "pdfkit";

const CANDID_YELLOW = "#fbd12c";
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 45;

const COMPANY_LINES = [
  "Candid Creative Limited",
  "Innovation House",
  "Cray Road, Sidcup",
  "DA14 5DP",
  "www.candidcreative.uk",
  "020 3149 8995",
  "Company no. 15150018",
  "VAT no. 451 8762 73",
];

export type PurchaseOrderPdfLine = {
  description: string;
  supplierSku: string | null;
  unit: string;
  quantity: number;
  unitPriceExVat: number;
  lineTotalExVat: number;
};

export type PurchaseOrderPdfDocument = {
  poNumber: string;
  revisionNumber: number;
  supplierName: string;
  supplierOrdersEmail: string | null;
  issuedAt: string;
  deliveryRecipient: string | null;
  deliveryLine1: string;
  deliveryLine2: string | null;
  deliveryCity: string | null;
  deliveryCounty: string | null;
  deliveryPostcode: string;
  deliveryCountry: string | null;
  deliveryInstructions: string | null;
  deliveryDate: string | null;
  deliveryChargeExVat: number;
  goodsExVat: number;
  subtotalExVat: number;
  vatRate: number;
  vatTotal: number;
  totalIncVat: number;
  lines: PurchaseOrderPdfLine[];
};

export function purchaseOrderPdfFilename(poNumber: string) {
  return /^PO-[1-9][0-9]*$/.test(poNumber) ? `${poNumber}.pdf` : "purchase-order.pdf";
}

export function purchaseOrderPdfSha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function renderPurchaseOrderPdf(document: PurchaseOrderPdfDocument) {
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    compress: false,
    info: {
      Title: document.poNumber,
      Author: "Candid Creative Limited",
      Subject: "Purchase order",
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.rect(0, 0, PAGE_WIDTH, 18).fill(CANDID_YELLOW);
  doc.fillColor("#1e1e1c").font("Helvetica-Bold").fontSize(18).text("Candid Creative", PAGE_MARGIN, 36);
  doc.font("Helvetica").fontSize(10).fillColor("#525252").text("Purchase order", PAGE_MARGIN, 58);
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#1e1e1c").text(document.poNumber, 320, 36, {
    width: PAGE_WIDTH - PAGE_MARGIN - 320,
    align: "right",
  });
  doc.font("Helvetica").fontSize(10).fillColor("#525252").text(
    `Issued ${formatDate(document.issuedAt)}`,
    320,
    58,
    { width: PAGE_WIDTH - PAGE_MARGIN - 320, align: "right" }
  );

  let y = 92;
  y = drawBlock(doc, "From", COMPANY_LINES, PAGE_MARGIN, y, 240);
  const supplierLines = [document.supplierName, document.supplierOrdersEmail].filter(
    (line): line is string => Boolean(line && line.trim())
  );
  const supplierBottom = drawBlock(doc, "Supplier", supplierLines, 320, 92, 230);
  y = Math.max(y, supplierBottom) + 16;

  const deliveryLines = [
    document.deliveryRecipient,
    document.deliveryLine1,
    document.deliveryLine2,
    [document.deliveryCity, document.deliveryCounty].filter(Boolean).join(", "),
    document.deliveryPostcode,
    document.deliveryCountry,
    document.deliveryDate ? `Required ${formatDate(document.deliveryDate)}` : null,
  ].filter((line): line is string => Boolean(line && line.trim()));
  y = drawBlock(doc, "Deliver to", deliveryLines, PAGE_MARGIN, y, PAGE_WIDTH - PAGE_MARGIN * 2);
  y += 18;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#1e1e1c");
  const columns = [PAGE_MARGIN, 280, 360, 420, 490];
  doc.text("Item", columns[0], y);
  doc.text("Qty", columns[1], y, { width: 70, align: "right" });
  doc.text("Unit", columns[2], y, { width: 50 });
  doc.text("Price", columns[3], y, { width: 60, align: "right" });
  doc.text("Amount", columns[4], y, { width: 60, align: "right" });
  y += 16;
  doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_WIDTH - PAGE_MARGIN, y).strokeColor("#e5e5e5").stroke();
  y += 8;

  doc.font("Helvetica").fontSize(9).fillColor("#1e1e1c");
  for (const line of document.lines) {
    const description = line.supplierSku
      ? `${line.description}\nSKU ${line.supplierSku}`
      : line.description;
    const height = doc.heightOfString(description, { width: 220 });
    if (y + height > PAGE_HEIGHT - 160) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    doc.text(description, columns[0], y, { width: 220 });
    doc.text(formatQuantity(line.quantity), columns[1], y, { width: 70, align: "right" });
    doc.text(line.unit, columns[2], y, { width: 50 });
    doc.text(formatGbp(line.unitPriceExVat), columns[3], y, { width: 60, align: "right" });
    doc.text(formatGbp(line.lineTotalExVat), columns[4], y, { width: 60, align: "right" });
    y += height + 10;
  }

  y += 8;
  const totals = [
    ["Goods ex VAT", document.goodsExVat],
    ["Delivery", document.deliveryChargeExVat],
    ["Subtotal", document.subtotalExVat],
    [vatLabel(document.vatRate), document.vatTotal],
    ["Total", document.totalIncVat],
  ] as const;
  for (const [label, amount] of totals) {
    doc.font(label === "Total" ? "Helvetica-Bold" : "Helvetica").fontSize(10);
    doc.text(label, 360, y, { width: 90 });
    doc.text(formatGbp(amount), 450, y, { width: 100, align: "right" });
    y += 16;
  }

  if (document.deliveryInstructions?.trim()) {
    y += 12;
    doc.font("Helvetica-Bold").fontSize(10).text("Notes", PAGE_MARGIN, y, { lineBreak: false });
    y += 16;
    const notes = document.deliveryInstructions.trim();
    doc.font("Helvetica").fontSize(9).text(notes, PAGE_MARGIN, y, {
      width: PAGE_WIDTH - PAGE_MARGIN * 2,
    });
    y += doc.heightOfString(notes, { width: PAGE_WIDTH - PAGE_MARGIN * 2 });
  }

  doc.font("Helvetica").fontSize(8).fillColor("#737373");
  doc.text(
    `Revision ${document.revisionNumber}. This document is the issued purchase order.`,
    PAGE_MARGIN,
    y + 16,
    { width: PAGE_WIDTH - PAGE_MARGIN * 2, lineBreak: false }
  );

  doc.end();
  return finished;
}

function drawBlock(
  doc: PDFKit.PDFDocument,
  title: string,
  lines: string[],
  x: number,
  y: number,
  width: number
) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#737373").text(title.toUpperCase(), x, y, {
    width,
  });
  doc.font("Helvetica").fontSize(10).fillColor("#1e1e1c");
  let cursor = y + 14;
  for (const line of lines) {
    doc.text(line, x, cursor, { width });
    cursor += doc.heightOfString(line, { width }) + 2;
  }
  return cursor;
}

function formatGbp(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 4 }).format(value);
}

function vatLabel(rate: number) {
  if (rate === 0.2) {
    return "VAT (20%)";
  }
  return "VAT";
}
