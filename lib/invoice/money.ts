import type { InvoiceItemRecord } from "@/lib/invoice/types";
import {
  NON_INVOICE_BILLING_STATUSES,
  UNPRICED_BILLING_STATUSES,
} from "@/lib/invoice/constants";

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function parseMoneyValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return roundMoney(parsed);
}

export function parseQuantityValue(value: unknown): number {
  const parsed = parseMoneyValue(value);
  if (parsed === null || parsed <= 0) {
    return 0;
  }

  return parsed;
}

export type InvoiceLineTotals = {
  netTotal: number;
  vatAmount: number;
  grossTotal: number;
};

export function calculateInvoiceLineTotals(input: {
  quantity: unknown;
  unitPrice: unknown;
  taxRate: unknown;
}): InvoiceLineTotals {
  const quantity = parseQuantityValue(input.quantity);
  const unitPrice = parseMoneyValue(input.unitPrice);
  const taxRate = parseMoneyValue(input.taxRate) ?? 0;

  if (quantity <= 0 || unitPrice === null) {
    return { netTotal: 0, vatAmount: 0, grossTotal: 0 };
  }

  const netTotal = roundMoney(quantity * unitPrice);
  const vatAmount = roundMoney(netTotal * (taxRate / 100));
  const grossTotal = roundMoney(netTotal + vatAmount);

  return { netTotal, vatAmount, grossTotal };
}

export function resolveBillingStatusAfterPricing(
  billingStatus: string,
  unitPrice: number | null
): string {
  if (unitPrice !== null && billingStatus === "price_required") {
    return "ready_to_invoice";
  }

  return billingStatus;
}

export function calculatePersistedLineNetTotal(input: {
  quantity: unknown;
  unitPrice: unknown;
  billingStatus: string;
}): number {
  const unitPrice = parseMoneyValue(input.unitPrice);

  if (unitPrice === null || input.billingStatus === "price_required") {
    return 0;
  }

  return calculateInvoiceLineTotals({
    quantity: input.quantity,
    unitPrice,
    taxRate: 0,
  }).netTotal;
}

export function normalizeInvoiceItemNumericFields(
  item: InvoiceItemRecord
): InvoiceItemRecord {
  const quantity = parseQuantityValue(item.quantity);
  const unitPrice = parseMoneyValue(item.unit_price);
  const taxRate = parseMoneyValue(item.tax_rate) ?? 0;
  const billingStatus = resolveBillingStatusAfterPricing(
    item.billing_status,
    unitPrice
  );
  const lineTotal = calculatePersistedLineNetTotal({
    quantity,
    unitPrice,
    billingStatus,
  });

  return {
    ...item,
    quantity,
    unit_price: unitPrice,
    tax_rate: taxRate,
    line_total: lineTotal,
    billing_status: billingStatus as InvoiceItemRecord["billing_status"],
  };
}

export function calculateInvoiceDraftTotals(items: InvoiceItemRecord[]) {
  const billableItems = items
    .filter(
      (item) =>
        !item.deleted_at &&
        !NON_INVOICE_BILLING_STATUSES.includes(
          item.billing_status as (typeof NON_INVOICE_BILLING_STATUSES)[number]
        )
    )
    .map(normalizeInvoiceItemNumericFields);

  let subtotal = 0;
  let taxTotal = 0;

  for (const item of billableItems) {
    const totals = calculateInvoiceLineTotals({
      quantity: item.quantity,
      unitPrice: item.unit_price,
      taxRate: item.tax_rate,
    });
    subtotal += totals.netTotal;
    taxTotal += totals.vatAmount;
  }

  return {
    subtotal: roundMoney(subtotal),
    tax_total: roundMoney(taxTotal),
    total: roundMoney(subtotal + taxTotal),
  };
}

export function invoiceLineNeedsPricing(item: InvoiceItemRecord) {
  const normalized = normalizeInvoiceItemNumericFields(item);

  return (
    normalized.unit_price === null ||
    UNPRICED_BILLING_STATUSES.includes(
      normalized.billing_status as (typeof UNPRICED_BILLING_STATUSES)[number]
    )
  );
}

export function draftTotalsMatchItems(
  draft: { subtotal: unknown; tax_total: unknown; total: unknown },
  items: InvoiceItemRecord[]
) {
  const calculated = calculateInvoiceDraftTotals(items);
  const subtotal = parseMoneyValue(draft.subtotal) ?? 0;
  const taxTotal = parseMoneyValue(draft.tax_total) ?? 0;
  const total = parseMoneyValue(draft.total) ?? 0;

  return (
    Math.abs(calculated.subtotal - subtotal) < 0.01 &&
    Math.abs(calculated.tax_total - taxTotal) < 0.01 &&
    Math.abs(calculated.total - total) < 0.01
  );
}
