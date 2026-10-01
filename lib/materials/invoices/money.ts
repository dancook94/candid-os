import type { PurchaseUnit } from "@/lib/materials/units";

import type { PriceComparison } from "@/lib/materials/invoices/model";

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function moneyMatches(left: number, right: number) {
  return roundMoney(left) === roundMoney(right);
}

export function compareApprovedPrice(
  currentPrice: number,
  invoicePrice: number,
  priceUnit: PurchaseUnit
): PriceComparison {
  const current = roundMoney(currentPrice);
  const invoice = roundMoney(invoicePrice);
  const difference = roundMoney(invoice - current);
  const percent = roundMoney((difference / current) * 100);

  return {
    currentPrice: current,
    invoicePrice: invoice,
    difference,
    percent,
    priceUnit,
  };
}

export function formatGbp(value: number) {
  const absolute = Math.abs(value).toFixed(2);
  return value < 0 ? `-£${absolute}` : `£${absolute}`;
}

export function formatSignedGbp(value: number) {
  if (value > 0) {
    return `+£${value.toFixed(2)}`;
  }

  if (value < 0) {
    return `-£${Math.abs(value).toFixed(2)}`;
  }

  return "£0.00";
}

export function formatSignedPercent(value: number) {
  if (value > 0) {
    return `+${value.toFixed(2)}%`;
  }

  if (value < 0) {
    return `-${Math.abs(value).toFixed(2)}%`;
  }

  return "0.00%";
}

export function lineMathsWarning(
  quantity: number | null,
  unitPrice: number | null,
  lineTotal: number | null
) {
  if (quantity == null || unitPrice == null || lineTotal == null) {
    return null;
  }

  const expected = roundMoney(quantity * unitPrice);

  if (!moneyMatches(expected, lineTotal)) {
    return `Quantity × unit price is ${formatGbp(expected)}, but the line total is ${formatGbp(lineTotal)}.`;
  }

  return null;
}

export function headerMathsWarning(
  subtotal: number | null,
  vat: number | null,
  total: number | null
) {
  if (subtotal == null || vat == null || total == null) {
    return null;
  }

  const expected = roundMoney(subtotal + vat);

  if (!moneyMatches(expected, total)) {
    return `Subtotal + VAT is ${formatGbp(expected)}, but the invoice total is ${formatGbp(total)}.`;
  }

  return null;
}
