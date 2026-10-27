import { normalizeMaterialLabel } from "@/lib/materials/identity";

import { headerMathsWarning, lineMathsWarning, moneyMatches, roundMoney } from "@/lib/materials/invoices/money";
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

const INVOICE_COLUMNS: Array<{ key: "invoiceNumber" | "invoiceDate"; pattern: RegExp }> = [
  { key: "invoiceNumber", pattern: /invoice\s*(?:number|no\.?|#)/i },
  { key: "invoiceDate", pattern: /invoice\s*date/i },
];

const OTHER_INVOICE_COLUMNS = [
  /account\s*no\.?/i,
  /cust(?:omer)?\.?\s*order\s*no\.?/i,
  /sales\s*order\s*no\.?/i,
  /despatch\s*date|dispatch\s*date/i,
];

export function parseInvoiceText(text: string): ParsedInvoice {
  const warnings: string[] = [];
  const sourceLines = invoiceSourceLines(text);
  const columns = readInvoiceColumns(sourceLines);
  const rawSupplierName = labeledText(text, ["supplier", "vendor"]);
  const invoiceNumber =
    labeledText(text, ["invoice number", "invoice no", "invoice #", "inv no"]) ??
    colonInvoiceNumber(text) ??
    spacedInvoiceNumber(text) ??
    invoiceNumberOnFollowingLine(text) ??
    columns?.invoiceNumber ??
    null;
  const invoiceDate =
    parseInvoiceDate(labeledText(text, ["invoice date", "tax date", "document date", "date"])) ??
    parseInvoiceDate(text.match(/\btax\s+date\s*:\s*([^\n]+)/i)?.[1] ?? null) ??
    parseInvoiceDate(text.match(/\binvoice\s+date\s*[:\-]?\s*([^\n]+)/i)?.[1] ?? null) ??
    dateOnFollowingLine(text, "document date") ??
    columns?.invoiceDate ??
    null;
  const subtotal =
    labeledMoney(text, ["subtotal", "total goods", "net", "goods total"]) ??
    totalNetAmount(text) ??
    papergraphicsCommercialNet(text);
  const vat =
    labeledAmount(text, /\bvat\s+\d+(?:\.\d+)?%\s+gbp\s+([\d,]+\.\d{2})\b/i) ??
    percentVatAmount(text) ??
    labeledMoney(text, ["vat", "tax"]);
  const total =
    labeledAmount(text, /\btotal\s+amount\s+gbp\s+([\d,]+\.\d{2})\b/i) ??
    labeledMoney(text, ["invoice total", "amount due", "total due"]) ??
    labeledMoney(text, ["total"]) ??
    totalWithTrailingWords(text);
  const lines = parseLines(sourceLines);

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

function invoiceSourceLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseLines(sourceLines: string[]): ParsedInvoiceLine[] {
  const headerIndex = sourceLines.findIndex((line) =>
    /^no\.\s+description\s+quantity\s+unit\b/i.test(line)
  );

  if (headerIndex >= 0) {
    return parseTableLines(sourceLines.slice(headerIndex + 1));
  }

  const quantityHeader = sourceLines.findIndex((line) =>
    /^quantity\s+description\s+unit\s+price\s+line\s+value\b/i.test(line)
  );

  if (quantityHeader >= 0) {
    return parseQuantityLines(sourceLines.slice(quantityHeader + 1));
  }

  const antalisHeader = sourceLines.findIndex((line) =>
    /item\s+material\s+customer\s+reference\s+weight\s+quantity\s+unit\s+price/i.test(line)
  );

  if (antalisHeader >= 0) {
    return parseAntalisLines(sourceLines.slice(antalisHeader + 1));
  }

  const ppbHeader = sourceLines.findIndex((line) =>
    /^line\s+item\s+code\s*\/\s*product\s+description\s+quantity\s+price\b/i.test(line)
  );

  if (ppbHeader >= 0) {
    return parsePpbLines(sourceLines.slice(ppbHeader + 1));
  }

  const papergraphicsHeader = sourceLines.findIndex((line) =>
    /^line\s+product\s+description\s+quantity\s+net\s+price\b/i.test(line)
  );

  if (papergraphicsHeader >= 0) {
    return parsePapergraphicsLines(sourceLines.slice(papergraphicsHeader + 1));
  }

  return parseSimpleLines(sourceLines);
}

const ANTALIS_PRODUCT =
  /^(.+?)\s+([\d,]+(?:\.\d+)?)\s+KG\s+([\d,]+(?:\.\d+)?)\s+([A-Za-z]{1,3})$/i;
const ANTALIS_PRICE =
  /^total\s+net\s+price\s+([\d,]+\.\d{2})\s+GBP\/(\d+(?:\.\d+)?)\s+([A-Za-z]{1,3})\s+([\d,]+\.\d{2})$/i;
const ANTALIS_CHARGE = /^(?!total\b)(.+?\bcharge)\s+GBP\s+([\d,]+\.\d{2})$/i;
const ANTALIS_CODE = /^\d+\s+(\d{5,})$/;
const ANTALIS_UNITS: Record<string, string> = {
  SH: "sheet",
  RL: "roll",
  UN: "unit",
  PK: "pack",
};

function parseAntalisLines(sourceLines: string[]) {
  const lines: ParsedInvoiceLine[] = [];
  let name: string | null = null;
  let quantity: number | null = null;
  let quantityUnit = "";
  let specs: string[] = [];
  let sku: string | null = null;

  const reset = () => {
    name = null;
    quantity = null;
    quantityUnit = "";
    specs = [];
    sku = null;
  };

  const pushProduct = (price: { per: number; priceUnit: string; amount: number; total: number } | null) => {
    if (!name || quantity == null) {
      reset();
      return;
    }

    const sameUnit = price != null && price.priceUnit === quantityUnit;
    const unitPrice = price && sameUnit ? price.amount / price.per : null;
    const description = [name, ...specs].join(" ");

    lines.push({
      lineNumber: lines.length + 1,
      rawDescription: normalizeMaterialLabel(description) ?? description,
      rawSupplierSku: sku,
      rawQuantity: quantity,
      rawUnit: sameUnit ? (ANTALIS_UNITS[quantityUnit] ?? quantityUnit) : quantityUnit,
      rawUnitPrice: unitPrice != null && price && moneyMatches(quantity * unitPrice, price.total) ? unitPrice : null,
      rawLineTotal: price?.total ?? null,
      rawTax: null,
    });
    reset();
  };

  for (const sourceLine of sourceLines) {
    if (/^total\s+net\s+amount\b/i.test(sourceLine)) {
      break;
    }

    if (isAntalisNoise(sourceLine)) {
      continue;
    }

    const charge = sourceLine.match(ANTALIS_CHARGE);

    if (charge && !name) {
      const total = parseMoney(charge[2]);

      if (total != null) {
        lines.push(chargeLine(lines.length + 1, charge[1], total));
      }

      continue;
    }

    const product = sourceLine.match(ANTALIS_PRODUCT);

    if (product) {
      if (name) {
        pushProduct(null);
      }

      name = product[1];
      quantity = Number(product[3].replace(/,/g, ""));
      quantityUnit = product[4].toUpperCase();
      specs = [];
      sku = null;
      continue;
    }

    const price = sourceLine.match(ANTALIS_PRICE);

    if (price && name) {
      const amount = parseMoney(price[1]);
      const total = parseMoney(price[4]);
      const per = Number(price[2]);

      if (amount == null || total == null || !(per > 0)) {
        pushProduct(null);
        continue;
      }

      pushProduct({ per, priceUnit: price[3].toUpperCase(), amount, total });
      continue;
    }

    const code = sourceLine.match(ANTALIS_CODE);

    if (code && name && !sku) {
      sku = code[1];
      continue;
    }

    if (name) {
      specs.push(sourceLine);
    }
  }

  if (name) {
    pushProduct(null);
  }

  return lines;
}

function parsePpbLines(sourceLines: string[]) {
  const lines: ParsedInvoiceLine[] = [];
  let current: { sku: string; quantity: number; total: number; description: string[] } | null = null;
  const row = /^(\d+)\s+([A-Z0-9]+(?:-[A-Z0-9]+)+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+\.\d{2})\s+\S+$/i;

  const push = () => {
    if (!current) {
      return;
    }

    const description = normalizeMaterialLabel(current.description.join(" ")) ?? current.sku;
    const unitPrice = perUnitPrice(current.quantity, current.total);

    lines.push({
      lineNumber: lines.length + 1,
      rawDescription: description,
      rawSupplierSku: current.sku,
      rawQuantity: current.quantity,
      rawUnit: null,
      rawUnitPrice: unitPrice,
      rawLineTotal: current.total,
      rawTax: null,
    });
    current = null;
  };

  for (const sourceLine of sourceLines) {
    if (/^net\s+£/i.test(sourceLine)) {
      push();
      break;
    }

    if (/^based on sales\b|^conditions of sale\b/i.test(sourceLine)) {
      push();
      continue;
    }

    const match = sourceLine.match(row);

    if (match) {
      push();
      const total = parseMoney(match[4]);
      const quantity = Number(match[3].replace(/,/g, ""));

      if (total == null || !Number.isFinite(quantity)) {
        continue;
      }

      current = { sku: match[2], quantity, total, description: [] };
      continue;
    }

    if (current) {
      current.description.push(sourceLine);
    }
  }

  push();
  return lines;
}

const PAPERGRAPHICS_ROW =
  /^(\d+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(?:(\d+)\s+)?(each|roll|sheet|sheets|pack|packs|box|boxes|unit|units|metre|metres)\s+([\d,]+\.\d{2})\s+GBP\s*\/\s*(\d+)\s+(\d+(?:\.\d+)?)\s*%\s+([\d,]+\.\d{2})\s+GBP$/i;

function parsePapergraphicsLines(sourceLines: string[]) {
  const lines: ParsedInvoiceLine[] = [];
  let current: { description: string; quantity: number; unit: string; unitPrice: number | null; total: number; tax: number | null } | null = null;

  const push = () => {
    if (!current) {
      return;
    }

    const description = papergraphicsDescription(current.description, current.unit);
    const sku = splitSku(description);

    lines.push({
      lineNumber: lines.length + 1,
      rawDescription: description,
      rawSupplierSku: sku.sku,
      rawQuantity: current.quantity,
      rawUnit: current.unit,
      rawUnitPrice: current.unitPrice,
      rawLineTotal: current.total,
      rawTax: current.tax,
    });
    current = null;
  };

  for (const sourceLine of sourceLines) {
    if (/^total\s+[\d,]+\.\d{2}\b/i.test(sourceLine)) {
      break;
    }

    const freight = sourceLine.match(/^freight\s+([\d,]+\.\d{2})\s+GBP$/i);

    if (freight) {
      push();
      const total = parseMoney(freight[1]);

      if (total != null) {
        lines.push(chargeLine(lines.length + 1, "Freight", total));
      }

      continue;
    }

    if (
      /^(?:list\s+price|vat\s*\(|no\s+cash\s+discount|total\s+item\s+net\s+value)/i.test(sourceLine) ||
      isPapergraphicsNoise(sourceLine)
    ) {
      continue;
    }

    const match = sourceLine.match(PAPERGRAPHICS_ROW);

    if (match) {
      push();
      const quantity = Number(match[3]);
      const amount = parseMoney(match[6]);
      const per = Number(match[7]);
      const total = parseMoney(match[9]);
      const unitPrice = amount != null && total != null && per > 0 && moneyMatches((quantity * amount) / per, total)
        ? amount / per
        : null;

      current = {
        description: match[2],
        quantity,
        unit: match[5],
        unitPrice,
        total: total ?? 0,
        tax: parseTaxRate(match[8]),
      };
      continue;
    }

    if (current) {
      current.description = `${current.description} ${sourceLine}`;
    }
  }

  push();
  return lines;
}

function isPapergraphicsNoise(line: string) {
  return /^(?:papergraphics limited|diva innovation|crawley|tel:|fsc coc|bic:|invoice:|page:)/i.test(line);
}

function papergraphicsDescription(description: string, unit: string) {
  const cleaned = description.replace(new RegExp(`\\s+${unit}\\s*$`, "i"), "");
  return normalizeMaterialLabel(cleaned) ?? cleaned;
}

function perUnitPrice(quantity: number, total: number) {
  if (!Number.isFinite(quantity) || quantity === 0) {
    return null;
  }

  const unitPrice = total / quantity;
  return moneyMatches(quantity * unitPrice, total) ? unitPrice : null;
}

function chargeLine(lineNumber: number, description: string, total: number): ParsedInvoiceLine {
  return {
    lineNumber,
    rawDescription: normalizeMaterialLabel(description) ?? description,
    rawSupplierSku: null,
    rawQuantity: 1,
    rawUnit: null,
    rawUnitPrice: total,
    rawLineTotal: total,
    rawTax: null,
  };
}

function isAntalisNoise(line: string) {
  return (
    /^(?:headquarters|antalis ltd|gateway house|leicestershire|vat reg|commercial office|viscom|tel:|invoice\b|bill-to|page \d|item material|description$|all orders|fsc\d|pefc\d|bank name|sort code|iban:|please send|customer:|inside sales|fsc certification)/i.test(line) ||
    /^with reference to your order\b/i.test(line) ||
    /^delivered to\b/i.test(line) ||
    /^\*\*\s*carry from prior pages/i.test(line) ||
    /^www\./i.test(line)
  );
}

function parseQuantityLines(sourceLines: string[]): ParsedInvoiceLine[] {
  const lines: ParsedInvoiceLine[] = [];
  let current: ParsedInvoiceLine | null = null;
  const pattern = new RegExp(
    `^(\\d+(?:\\.\\d+)?)\\s+(.+?)\\s+£?\\s*(${UNIT_PRICE})\\s+£?\\s*(${LINE_TOTAL})(?:\\s+[A-Za-z])?\\s*$`,
    "i"
  );

  for (const sourceLine of sourceLines) {
    if (
      /^(?:total\s+goods|total\s+due|subtotal|vat|our bank|remittances)\b/i.test(sourceLine)
    ) {
      break;
    }

    const match = sourceLine.match(pattern);

    if (match) {
      if (current) {
        lines.push(finishLine(current, lines.length + 1));
      }

      const description = normalizeMaterialLabel(match[2]) ?? match[2];
      const quantity = Number(match[1]);
      const unitPrice = parseMoney(match[3]);
      const lineTotal = parseMoney(match[4]);

      current =
        unitPrice == null || lineTotal == null || !Number.isFinite(quantity)
          ? null
          : {
              lineNumber: 0,
              rawDescription: description,
              rawSupplierSku: splitSku(description).sku,
              rawQuantity: quantity,
              rawUnit: describedPurchaseUnit(description),
              rawUnitPrice: unitPrice,
              rawLineTotal: lineTotal,
              rawTax: null,
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

function readInvoiceColumns(sourceLines: string[]) {
  for (let index = 0; index < sourceLines.length - 1; index += 1) {
    const columns = columnKeys(sourceLines[index]);

    if (!columns.includes("invoiceNumber") || !columns.includes("invoiceDate")) {
      continue;
    }

    const tokens = sourceLines[index + 1].split(/\s+/);

    if (tokens.length === columns.length) {
      const invoiceNumber = acceptInvoiceNumber(tokens[columns.indexOf("invoiceNumber")] ?? "");
      const invoiceDate = parseInvoiceDate(tokens[columns.indexOf("invoiceDate")] ?? null);

      if (invoiceNumber && invoiceDate) {
        return { invoiceNumber, invoiceDate };
      }
    }

    const anchored = anchorInvoiceNumberAndDate(columns, tokens);

    if (anchored) {
      return anchored;
    }
  }

  return null;
}

function anchorInvoiceNumberAndDate(
  columns: Array<"invoiceNumber" | "invoiceDate" | "other">,
  tokens: string[]
) {
  if (columns[0] !== "invoiceNumber" || columns[1] !== "invoiceDate" || tokens.length < 3) {
    return null;
  }

  const invoiceNumber = acceptInvoiceNumber(tokens[0] ?? "");
  const invoiceDate = parseInvoiceDate(tokens[1] ?? null);
  const closingDate = parseInvoiceDate(tokens[tokens.length - 1] ?? null);

  if (!invoiceNumber || !invoiceDate || !closingDate) {
    return null;
  }

  return { invoiceNumber, invoiceDate };
}

export function describedPurchaseUnit(description: string) {
  const roll =
    /\b\d+(?:\.\d+)?\s*m\s*[x×]\s*\d+(?:\.\d+)?\s*mm\b/i.test(description) ||
    /\b\d+(?:\.\d+)?\s*mm\s*[x×]\s*\d+(?:\.\d+)?\s*m\b/i.test(description) ||
    /\b\d+(?:\.\d+)?\s*yds?\s*[x×]\s*\d{3,4}(?:\.\d+)?(?:\s*mm)?\b/i.test(description) ||
    rollLengthAndWidth(description);
  const widths = [...description.matchAll(/\b\d{3,4}\s*mm\b/gi)];
  const linear = !roll && widths.length === 1 && !/[x×]/i.test(description);

  if (roll === linear) {
    return null;
  }

  return roll ? "roll" : "linear_metre";
}

function rollLengthAndWidth(description: string) {
  const match = description.match(/\b(\d{1,3}(?:\.\d+)?)\s*[x×]\s*(\d{3,4})\b/i);

  if (!match || /(?:m|mm|yds?)\s*$/i.test(match[0])) {
    return false;
  }

  const length = Number(match[1]);
  const width = Number(match[2]);
  return length > 0 && length <= 150 && width >= 500 && width <= 3200;
}

function columnKeys(line: string) {
  const labels = [
    ...INVOICE_COLUMNS,
    ...OTHER_INVOICE_COLUMNS.map((pattern) => ({ key: "other" as const, pattern })),
  ];
  const found: Array<"invoiceNumber" | "invoiceDate" | "other"> = [];
  let rest = line;

  while (rest.length > 0) {
    let earliest: { key: "invoiceNumber" | "invoiceDate" | "other"; index: number; length: number } | null =
      null;

    for (const label of labels) {
      const match = rest.match(label.pattern);

      if (match?.index == null) {
        continue;
      }

      if (!earliest || match.index < earliest.index) {
        earliest = { key: label.key, index: match.index, length: match[0].length };
      }
    }

    if (!earliest) {
      break;
    }

    found.push(earliest.key);
    rest = rest.slice(earliest.index + earliest.length);
  }

  return found;
}

function acceptInvoiceNumber(value: string) {
  if (/^\d{4,12}$/.test(value) || (/[A-Za-z]/.test(value) && /\d/.test(value))) {
    return value;
  }

  return null;
}

function spacedInvoiceNumber(text: string) {
  const match = text.match(/\binvoice\s+number\s+(\d{4,12})\b/i);
  return acceptInvoiceNumber(match?.[1] ?? "");
}

function totalNetAmount(text: string) {
  return labeledAmount(text, /\btotal\s+net\s+amount\s+gbp\s+([\d,]+\.\d{2})\b/i);
}

function papergraphicsCommercialNet(text: string) {
  if (!/^line\s+product\s+description\s+quantity\s+net\s+price\b/im.test(text)) {
    return null;
  }

  const itemNet = labeledAmount(text, /\btotal\s+item\s+net\s+value\s+([\d,]+\.\d{2})\b/i);

  if (itemNet == null) {
    return null;
  }

  let freight = 0;

  for (const match of text.matchAll(/^freight\s+([\d,]+\.\d{2})\s+gbp$/gim)) {
    freight += parseMoney(match[1]) ?? 0;
  }

  return roundMoney(itemNet + freight);
}

function labeledAmount(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return match ? parseMoney(match[1]) : null;
}

function colonInvoiceNumber(text: string) {
  const match = text.match(/\binvoice\s*:\s*([A-Za-z0-9][A-Za-z0-9\-/]+)/i);
  return acceptInvoiceNumber(match?.[1] ?? "");
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
    /(?:^|\n)\s*total\b(?!\s+net\s+price)(?:(?![\d,]+\.\d{2})[^\n]){0,40}£?\s*([\d,]+\.\d{2})\b/i
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
