import { formatGbp } from "@/lib/materials/invoices/money";
import type { PurchaseUnit } from "@/lib/materials/units";

export const PERMANENT_LINE_ACTIONS = [
  "material_created",
  "supplier_product_created",
  "opening_price_created",
  "invoice_line_resolved",
  "price_change_approved",
  "price_change_rejected",
] as const;

const REPLACED_PRICE =
  "This invoice line has an approved material price and cannot be replaced.";
const REPLACED_MAPPING =
  "This invoice line created a product description mapping and cannot be replaced.";
const REPLACED_IGNORE =
  "This invoice line created an ignore rule and cannot be replaced.";
const REPLACED_DECISION =
  "This invoice line has a permanent decision and cannot be replaced.";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function reprocessBlockReason(input: {
  lineIds: readonly string[];
  invoicePriceLineIds: readonly string[];
  mappingLineIds: readonly string[];
  ignoreRuleLineIds: readonly string[];
  events: readonly { lineId: string | null; action: string }[];
}) {
  const lines = new Set(input.lineIds);

  if (lines.size === 0) {
    return null;
  }

  const onInvoice = (lineId: string | null | undefined) =>
    lineId != null && lines.has(lineId);

  if (input.invoicePriceLineIds.some((lineId) => onInvoice(lineId))) {
    return REPLACED_PRICE;
  }

  if (input.mappingLineIds.some((lineId) => onInvoice(lineId))) {
    return REPLACED_MAPPING;
  }

  if (input.ignoreRuleLineIds.some((lineId) => onInvoice(lineId))) {
    return REPLACED_IGNORE;
  }

  if (
    input.events.some(
      (event) =>
        onInvoice(event.lineId) &&
        (PERMANENT_LINE_ACTIONS as readonly string[]).includes(event.action)
    )
  ) {
    return REPLACED_DECISION;
  }

  return null;
}

export function priceApprovalConsequence(input: {
  invoiceDate: string | null;
  currentEffectiveDate: string;
  invoicePrice: number;
  currentPrice: number;
}) {
  const invoicePrice = formatGbp(input.invoicePrice);
  const currentPrice = formatGbp(input.currentPrice);

  if (!input.invoiceDate) {
    return {
      effect: "missing_date" as const,
      message: "This invoice has no date, so a new price cannot be approved until the invoice date is known.",
    };
  }

  if (input.invoiceDate < input.currentEffectiveDate) {
    return {
      effect: "history" as const,
      message: `This invoice is older than the current approved price. Approving ${invoicePrice} will add it to price history. The current price will remain ${currentPrice}.`,
    };
  }

  if (input.invoiceDate > input.currentEffectiveDate) {
    return {
      effect: "current" as const,
      message: `Approving ${invoicePrice} will make it the current price from ${formatIsoDate(input.invoiceDate)}. ${currentPrice} will remain in price history.`,
    };
  }

  return {
    effect: "same_date" as const,
    message: `This invoice has the same date as the current approved price. Approving ${invoicePrice} will make it the current price, because the later approval is current when the dates match. ${currentPrice} will remain in price history.`,
  };
}

export function formatPriceDecision(action: string, metadata: unknown) {
  const details = metadataRecord(metadata);
  const unit = typeof details.priceUnit === "string" ? details.priceUnit : "unit";
  const invoicePrice = moneyField(details.invoicePrice);
  const currentPrice = moneyField(details.currentPrice ?? details.previousPrice);

  if (action === "price_change_approved" && invoicePrice != null) {
    if (details.becameCurrent === false && currentPrice != null) {
      return `Approved ${formatGbp(invoicePrice)} per ${unitLabel(unit)} as historical evidence. The current price remained ${formatGbp(currentPrice)}.`;
    }

    const effective =
      typeof details.effectiveDate === "string" ? formatIsoDate(details.effectiveDate) : null;
    return `Approved ${formatGbp(invoicePrice)} per ${unitLabel(unit)}${effective ? ` from ${effective}` : ""}. It became the current price. The previous price remains in history.`;
  }

  if (action === "price_change_rejected" && invoicePrice != null && currentPrice != null) {
    return `Kept the current price of ${formatGbp(currentPrice)} per ${unitLabel(unit)}. The invoice price of ${formatGbp(invoicePrice)} was not applied. A later invoice with a different price will be shown again.`;
  }

  if (action === "price_change_queried") {
    return "Queried. No price was created. The current approved price is unchanged.";
  }

  return null;
}

function moneyField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataRecord(metadata: unknown) {
  return metadata != null && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {};
}

function unitLabel(unit: string) {
  const labels: Record<PurchaseUnit, string> = {
    sheet: "sheet",
    roll: "roll",
    linear_metre: "linear metre",
    square_metre: "square metre",
    unit: "unit",
    pack: "pack",
  };
  return unit in labels ? labels[unit as PurchaseUnit] : unit;
}

function formatIsoDate(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-");
  const monthName = MONTHS[Number(month) - 1];

  if (!year || !monthName || !day) {
    return iso;
  }

  return `${Number(day)} ${monthName} ${year}`;
}
