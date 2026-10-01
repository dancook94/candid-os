import { normalizeMaterialLabel } from "@/lib/materials/identity";

import { headerMathsWarning, lineMathsWarning } from "@/lib/materials/invoices/money";
import type { ParsedInvoice, ParsedInvoiceLine } from "@/lib/materials/invoices/model";

const UNIT_TOKEN =
  "sheet|sheets|roll|rolls|m|metre|metres|meter|meters|each|unit|units|pack|packs|box|boxes";

const LINE_PATTERN = new RegExp(
  `^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s+(?:(${UNIT_TOKEN})\\s+)?£?\\s*([\\d,]+\\.\\d{2})\\s+£?\\s*([\\d,]+\\.\\d{2})\\s*$`,
  "i"
);

export function parseInvoiceText(text: string): ParsedInvoice {
  const warnings: string[] = [];
  const rawSupplierName = labeledText(text, ["supplier", "vendor"]);
  const invoiceNumber = labeledText(text, [
    "invoice number",
    "invoice no",
    "invoice #",
    "inv no",
  ]);
  const invoiceDate = parseInvoiceDate(labeledText(text, ["invoice date", "date"]));
  const subtotal = labeledMoney(text, ["subtotal", "net", "goods total"]);
  const vat = labeledMoney(text, ["vat", "tax"]);
  const total = labeledMoney(text, ["invoice total", "amount due", "total"]);
  const lines = parseLines(text);

  if (!rawSupplierName) {
    warnings.push("Supplier was not labelled on the invoice.");
  }

  if (!invoiceNumber) {
    warnings.push("Invoice number was not found.");
  }

  if (!invoiceDate) {
    warnings.push("Invoice date was not found.");
  }

  if (lines.length === 0) {
    warnings.push("No invoice lines could be read from the text.");
  }

  const headerWarning = headerMathsWarning(subtotal, vat, total);

  if (headerWarning) {
    warnings.push(headerWarning);
  }

  const lineTotal = lines.reduce((sum, line) => sum + (line.rawLineTotal ?? 0), 0);

  if (
    subtotal != null &&
    lines.length > 0 &&
    Math.round(lineTotal * 100) !== Math.round(subtotal * 100)
  ) {
    warnings.push("The line totals do not add up to the subtotal.");
  }

  return {
    rawSupplierName,
    invoiceNumber,
    invoiceDate,
    subtotal,
    vat,
    total,
    lines,
    warnings,
  };
}

function parseLines(text: string): ParsedInvoiceLine[] {
  const lines: ParsedInvoiceLine[] = [];

  for (const sourceLine of text.split(/\r?\n/)) {
    const match = sourceLine.trim().match(LINE_PATTERN);

    if (!match) {
      continue;
    }

    const descriptionAndSku = splitSku(match[1]);
    const quantity = Number(match[2]);
    const unitPrice = parseMoney(match[4]);
    const lineTotal = parseMoney(match[5]);

    if (unitPrice == null || lineTotal == null || !Number.isFinite(quantity)) {
      continue;
    }

    lines.push({
      lineNumber: lines.length + 1,
      rawDescription: descriptionAndSku.description,
      rawSupplierSku: descriptionAndSku.sku,
      rawQuantity: quantity,
      rawUnit: match[3] ? match[3].toLowerCase() : null,
      rawUnitPrice: unitPrice,
      rawLineTotal: lineTotal,
      rawTax: null,
    });
  }

  return lines;
}

function splitSku(value: string) {
  const cleaned = normalizeMaterialLabel(value) ?? "";
  const match = cleaned.match(/^([A-Za-z0-9][A-Za-z0-9\-/]{2,})\s+(.+)$/);

  const token = match?.[1] ?? "";

  if (
    !match ||
    !/[A-Za-z]/.test(match[2]) ||
    /(?:mm|gsm)$/i.test(token) ||
    !/\d/.test(token) ||
    !/[A-Za-z]/.test(token)
  ) {
    return { sku: null, description: cleaned };
  }

  return {
    sku: token,
    description: normalizeMaterialLabel(match[2]) ?? cleaned,
  };
}

function labeledText(text: string, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(
      `(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[:\\-]\\s*(.+)$`,
      "im"
    );
    const match = text.match(pattern);
    const value = normalizeMaterialLabel(match?.[1] ?? "");

    if (value) {
      return value;
    }
  }

  return null;
}

function labeledMoney(text: string, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(
      `(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[:\\-]?\\s*£?\\s*([\\d,]+\\.\\d{2})\\b`,
      "im"
    );
    const match = text.match(pattern);

    if (match) {
      return parseMoney(match[1]);
    }
  }

  return null;
}

function parseInvoiceDate(value: string | null) {
  if (!value) {
    return null;
  }

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (iso) {
    return iso[0];
  }

  const uk = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);

  if (!uk) {
    return null;
  }

  const day = uk[1].padStart(2, "0");
  const month = uk[2].padStart(2, "0");
  return `${uk[3]}-${month}-${day}`;
}

function parseMoney(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function lineHasMathsWarning(line: ParsedInvoiceLine) {
  return lineMathsWarning(line.rawQuantity, line.rawUnitPrice, line.rawLineTotal);
}
