import { normalizeMaterialLabel } from "@/lib/materials/identity";

import { headerMathsWarning, lineMathsWarning } from "@/lib/materials/invoices/money";
import type { ParsedInvoice, ParsedInvoiceLine } from "@/lib/materials/invoices/model";

const UNIT_TOKEN =
  "sheet|sheets|roll|rolls|m|metre|metres|meter|meters|each|unit|units|pack|packs|box|boxes";

const UNIT_PRICE = "[\\d,]+\\.\\d{2,3}";
const LINE_TOTAL = "[\\d,]+\\.\\d{2}";

const LINE_PATTERN = new RegExp(
  `^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s+(?:(${UNIT_TOKEN})\\s+)?£?\\s*(${UNIT_PRICE})\\s+£?\\s*(${LINE_TOTAL})\\s*$`,
  "i"
);

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

const TABLE_LINE = new RegExp(
  `^([A-Za-z][A-Za-z0-9\\-/]{2,})\\s+(.+)\\s+(\\d+(?:\\.\\d+)?)\\s+(${UNIT_TOKEN})\\s+£?\\s*(${UNIT_PRICE})\\s+(\\d+(?:\\.\\d+)?%?)\\s+£?\\s*(${LINE_TOTAL})\\s*$`,
  "i"
);

export function parseInvoiceText(text: string): ParsedInvoice {
  const warnings: string[] = [];
  const rawSupplierName = labeledText(text, ["supplier", "vendor"]);
  const invoiceNumber =
    labeledText(text, ["invoice number", "invoice no", "invoice #", "inv no"]) ??
    invoiceNumberOnFollowingLine(text);
  const invoiceDate =
    parseInvoiceDate(labeledText(text, ["invoice date", "document date", "date"])) ??
    dateOnFollowingLine(text, "document date");
  const subtotal = labeledMoney(text, ["subtotal", "net", "goods total"]);
  const vat = percentVatAmount(text) ?? labeledMoney(text, ["vat", "tax"]);
  const total =
    labeledMoney(text, ["invoice total", "amount due"]) ??
    labeledMoney(text, ["total"]) ??
    totalWithTrailingWords(text);
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
  const sourceLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = sourceLines.findIndex((line) =>
    /^no\.\s+description\s+quantity\s+unit\b/i.test(line)
  );

  if (headerIndex >= 0) {
    return parseTableLines(sourceLines.slice(headerIndex + 1));
  }

  return parseSimpleLines(sourceLines);
}

function parseTableLines(sourceLines: string[]): ParsedInvoiceLine[] {
  const lines: ParsedInvoiceLine[] = [];
  let current: ParsedInvoiceLine | null = null;

  for (const sourceLine of sourceLines) {
    if (/^(?:subtotal|total)\b/i.test(sourceLine) || /^\d+(?:\.\d+)?%\s+vat\b/i.test(sourceLine)) {
      break;
    }

    const match = sourceLine.match(TABLE_LINE);

    if (match && isSkuToken(match[1])) {
      if (current) {
        lines.push(finishLine(current, lines.length + 1));
      }

      const unitPrice = parseMoney(match[5]);
      const lineTotal = parseMoney(match[7]);
      const quantity = Number(match[3]);

      current =
        unitPrice == null || lineTotal == null || !Number.isFinite(quantity)
          ? null
          : {
              lineNumber: 0,
              rawDescription: normalizeMaterialLabel(match[2]) ?? match[2],
              rawSupplierSku: match[1],
              rawQuantity: quantity,
              rawUnit: match[4],
              rawUnitPrice: unitPrice,
              rawLineTotal: lineTotal,
              rawTax: parseTaxRate(match[6]),
            };
      continue;
    }

    if (current) {
      current.rawDescription =
        normalizeMaterialLabel(`${current.rawDescription} ${sourceLine}`) ?? current.rawDescription;
    }
  }

  if (current) {
    lines.push(finishLine(current, lines.length + 1));
  }

  return lines;
}

function parseSimpleLines(sourceLines: string[]): ParsedInvoiceLine[] {
  const lines: ParsedInvoiceLine[] = [];

  for (const sourceLine of sourceLines) {
    const match = sourceLine.match(LINE_PATTERN);

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

function finishLine(line: ParsedInvoiceLine, lineNumber: number) {
  return { ...line, lineNumber };
}

function isSkuToken(value: string) {
  return /\d/.test(value) && /[A-Za-z]/.test(value) && !/(?:mm|gsm)$/i.test(value);
}

function parseTaxRate(value: string) {
  const parsed = Number(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
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

function invoiceNumberOnFollowingLine(text: string) {
  const match = text.match(
    /invoice\s*(?:number|no\.?|#)\s*[:\-]?\s*\n+\s*([A-Za-z0-9][A-Za-z0-9\-/]+)/i
  );
  const value = match?.[1] ?? "";

  if (!/\d/.test(value) || !/[A-Za-z]/.test(value)) {
    return null;
  }

  return value;
}

function dateOnFollowingLine(text: string, label: string) {
  const pattern = new RegExp(`${escapeRegExp(label)}[^\\n]*\\n\\s*([^\\n]+)`, "i");
  return parseInvoiceDate(text.match(pattern)?.[1] ?? null);
}

function percentVatAmount(text: string) {
  const match = text.match(
    /(?:^|\n)\s*\d+(?:\.\d+)?%\s+vat\s*[:\-]?\s*£?\s*([\d,]+\.\d{2})\b/i
  );
  return match ? parseMoney(match[1]) : null;
}

function totalWithTrailingWords(text: string) {
  const match = text.match(
    /(?:^|\n)\s*total\b(?:(?![\d,]+\.\d{2})[^\n]){0,40}£?\s*([\d,]+\.\d{2})\b/i
  );
  return match ? parseMoney(match[1]) : null;
}

function parseInvoiceDate(value: string | null) {
  if (!value) {
    return null;
  }

  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);

  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const uk = value.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/);

  if (uk) {
    return `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  }

  const written = value.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/);
  const month = written ? MONTHS[written[2].toLowerCase()] : null;

  if (!written || !month) {
    return null;
  }

  return `${written[3]}-${month}-${written[1].padStart(2, "0")}`;
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
