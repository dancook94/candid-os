import { buildMaterialIdentityKey } from "@/lib/materials/identity";
import { normalizeSupplierDescription } from "@/lib/materials/identity";
import {
  existingLinkConflict,
  invoiceWidthConflicts,
  normalizePurchaseUnit,
  reliableRollSize,
  reliableSheetSize,
} from "@/lib/materials/invoices/match";
import type { InvoiceMatchProduct, InvoiceReviewStatus } from "@/lib/materials/invoices/model";
import { formatGbp, hasUnresolvedInvoiceTotalWarning, moneyMatches, roundMoney } from "@/lib/materials/invoices/money";
import { calculateCostPerSquareMetre } from "@/lib/materials/pricing";
import {
  isPurchaseUnit,
  PURCHASE_UNIT_LABELS,
  type PurchaseUnit,
} from "@/lib/materials/units";

const OPEN_STATUSES = new Set<InvoiceReviewStatus>([
  "unmatched",
  "needs_review",
  "price_change",
  "extraction_error",
  "query",
]);

const CHARGE_PATTERN =
  /\b(carriage|shipping|freight|postage|couriers?|delivery|overnight|next day|packaging|package to send|small order)\b/i;

const MATERIAL_WORD =
  /\b(fabric|hips|vinyl|ink|paper|banner|dibond|foam|acrylic|laminate|board)\b/i;

export type BulkReviewSourceInvoice = {
  id: string;
  number: string | null;
  date: string | null;
  supplierId: string | null;
  supplierName: string | null;
  extractionStatus: string;
  extractionWarnings: string[];
  processingStatus: string;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
};

export type BulkReviewSourceLine = {
  id: string;
  invoiceId: string;
  description: string;
  sku: string | null;
  quantity: number | null;
  statedUnit: string | null;
  reviewedUnit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  reviewStatus: InvoiceReviewStatus;
  mathsWarning: string | null;
  matchedProductId: string | null;
  matchConfidence: "high" | "medium" | "low" | null;
  historicalPriceRetained: boolean;
  bulkPriceApproved: boolean;
  roundingAccepted: boolean;
};

export type BulkCatalogueMaterial = {
  id: string;
  name: string;
  purchaseUnit: PurchaseUnit;
  thicknessMm: number | null;
  colour: string | null;
  finish: string | null;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
};

export type BulkReviewKind =
  | "charge"
  | "historical_price"
  | "existing_link"
  | "existing_product"
  | "purchase_unit"
  | "new_material"
  | "rounding"
  | "repair";

export type BulkProductChoice = {
  id: string;
  materialName: string;
  description: string;
  purchaseUnit: PurchaseUnit;
  currentPrice: number | null;
  dimensions: string;
};

export type BulkReviewLineView = {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  description: string;
  sku: string | null;
  quantity: number | null;
  statedUnit: string | null;
  reviewedUnit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  reviewStatus: InvoiceReviewStatus;
  olderThanCurrentPrice: boolean;
  supplierId: string | null;
};

export type BulkReviewGroup = {
  id: string;
  kind: BulkReviewKind;
  supplierId: string | null;
  supplierName: string;
  title: string;
  invoiceCount: number;
  lineCount: number;
  invoices: Array<{ id: string; number: string | null; date: string | null }>;
  sku: string | null;
  dimensions: string | null;
  statedUnit: string | null;
  purchaseUnit: PurchaseUnit | null;
  suggestedUnit: PurchaseUnit | null;
  catalogueMaterial: string | null;
  cataloguePrice: number | null;
  currentPriceId: string | null;
  currentEffectiveDate: string | null;
  invoicePrice: number | null;
  proposedAction: string;
  warnings: string[];
  canApply: boolean;
  lines: BulkReviewLineView[];
  productId: string | null;
  choices: BulkProductChoice[];
  proposedName: string | null;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
  similarMaterials: Array<{ id: string; name: string }>;
  blockedReason: string | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
};

export type BulkReviewSummary = {
  openLineCount: number;
  groupedLineCount: number;
  individualLineCount: number;
  repairLineCount: number;
  repairInvoiceCount: number;
};

export type BulkDecision = {
  confirmed: boolean;
  lineIds: string[];
} & (
  | { action: "ignore_charges" }
  | { action: "confirm_product"; productId: string }
  | { action: "confirm_existing_link"; productId: string }
  | { action: "keep_historical_price" }
  | { action: "approve_current_price"; approveCurrent: boolean }
  | { action: "set_purchase_unit"; unit: string }
  | { action: "accept_rounding"; acceptRounding: boolean }
  | {
      action: "create_material";
      name: string;
      openingPrice: number;
      acknowledgedSimilar: boolean;
    }
);

export type BulkPlan =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      alreadyComplete: boolean;
      appliesToFutureInvoices: false;
      lineIds: string[];
      write:
        | {
            type: "ignore_charges";
            createIgnoreRule: false;
            createMaterial: false;
            createPrice: false;
          }
        | {
            type: "confirm_product";
            productId: string;
            createMapping: false;
            createPrice: false;
          }
        | {
            type: "confirm_existing_link";
            productId: string;
            createMapping: false;
            createPrice: false;
            createsMaterial: false;
          }
        | {
            type: "keep_historical_price";
            productId: string;
            invoicePrice: number;
            currentPriceId: string;
            changesCurrentPrice: false;
            changesSupplierPreference: false;
            changesQuotes: false;
            createPrice: false;
          }
        | {
            type: "approve_current_price";
            productId: string;
            invoicePrice: number;
            currentPriceId: string;
            changesCurrentPrice: true;
            priceCount: 1;
            changesSupplierPreference: false;
            changesQuotes: false;
          }
        | {
            type: "set_purchase_unit";
            unit: PurchaseUnit;
            createMaterial: false;
            createPrice: false;
          }
        | {
            type: "accept_rounding";
            changesInvoiceTotals: false;
          }
        | {
            type: "create_material";
            name: string;
            openingPrice: number;
            unit: PurchaseUnit;
            supplierId: string;
            sku: string | null;
            widthMm: number | null;
            heightMm: number | null;
            lengthMm: number | null;
            createMapping: false;
            priceCount: 1;
            preferred: false;
          }
        | null;
    };

type SizeRead = {
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
  label: string | null;
  slit: boolean;
  ambiguousSlit: boolean;
};

export function cleanInvoiceProductName(description: string) {
  const cleaned = description
    .replace(/\*+[^*]*\**/g, " ")
    .replace(/\b(?:same day couriers?|addition to order|to convert|paperwork only|another one)\b/gi, " ")
    .replace(/\bsee\s+[a-z]{2,}\b/gi, " ")
    .replace(/\bpls despatch\b[^,]*/gi, " ")
    .replace(/\bpass to\b[^,]*/gi, " ")
    .replace(/\bcarriage agreed\b[^,]*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

export function purchaseUnitGuidance(input: {
  statedUnit: string | null;
  unit: PurchaseUnit | null;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
  price: number | null;
}) {
  const notes: string[] = [];
  const stated = input.statedUnit?.trim() ?? "";

  if (/^bl$/i.test(stated)) {
    notes.push("BL is not a catalogue unit. It is not treated as a roll or a sheet.");
  } else if (/^pk$/i.test(stated)) {
    notes.push("PK is not a catalogue unit. It is not treated as sheets.");
  } else if (stated && !normalizePurchaseUnit(stated)) {
    notes.push(`${stated} is not a catalogue purchase unit.`);
  }

  if (input.unit === "litre") {
    notes.push(
      "This price is per litre. It is not converted into square metres, and the invoice price is not recalculated."
    );
    return notes.join(" ");
  }

  if (!input.unit) {
    notes.push("Choose a purchase unit from the list. No conversion is applied before that choice.");
    return notes.join(" ");
  }

  const perSquareMetre =
    input.price == null
      ? null
      : calculateCostPerSquareMetre({
          price: input.price,
          priceUnit: input.unit,
          widthMm: input.widthMm,
          heightMm: input.heightMm,
          lengthMm: input.lengthMm,
        });

  if (perSquareMetre == null) {
    notes.push(
      `No conversion factor is stored for ${PURCHASE_UNIT_LABELS[input.unit].toLowerCase()} with the size read from the invoice. The invoice price is not recalculated.`
    );
  } else {
    notes.push(
      `At ${PURCHASE_UNIT_LABELS[input.unit].toLowerCase()} and the extracted size, ${formatGbp(input.price ?? 0)} is ${formatGbp(perSquareMetre)} per square metre. The invoice price itself is not recalculated.`
    );
  }

  return notes.join(" ");
}

export function buildBulkReview(input: {
  invoices: readonly BulkReviewSourceInvoice[];
  lines: readonly BulkReviewSourceLine[];
  products: readonly InvoiceMatchProduct[];
  materials: readonly BulkCatalogueMaterial[];
}) {
  const invoicesById = new Map(input.invoices.map((invoice) => [invoice.id, invoice]));
  const linesByInvoice = new Map<string, BulkReviewSourceLine[]>();

  for (const line of input.lines) {
    const list = linesByInvoice.get(line.invoiceId) ?? [];
    list.push(line);
    linesByInvoice.set(line.invoiceId, list);
  }

  const groups: BulkReviewGroup[] = [];
  const claimed = new Set<string>();

  for (const invoice of input.invoices) {
    const invoiceLines = linesByInvoice.get(invoice.id) ?? [];

    if (
      invoiceLines.length === 0 &&
      invoice.processingStatus !== "processed" &&
      invoice.processingStatus !== "ignored"
    ) {
      groups.push(
        visibleRepair(invoice, [
          invoice.extractionWarnings.some((warning) => /no invoice lines/i.test(warning))
            ? "No invoice lines could be read from this invoice."
            : "This invoice has no lines to review.",
        ])
      );
      continue;
    }

    const totalWarnings = invoice.extractionWarnings.filter((warning) =>
      hasUnresolvedInvoiceTotalWarning([warning])
    );

    if (invoiceLines.length > 0 && invoiceLines.every((line) => !OPEN_STATUSES.has(line.reviewStatus)) && totalWarnings.length > 0) {
      groups.push(visibleRepair(invoice, totalWarnings));
    }
  }

  const buckets = new Map<string, { kind: BulkReviewKind; lines: BulkReviewSourceLine[]; seed: BulkReviewGroup }>();

  function add(key: string, kind: BulkReviewKind, line: BulkReviewSourceLine, seed: BulkReviewGroup) {
    const existing = buckets.get(key);

    if (existing) {
      existing.lines.push(line);
      return;
    }

    seed.id = key;
    buckets.set(key, { kind, lines: [line], seed });
  }

  for (const line of input.lines) {
    if (!OPEN_STATUSES.has(line.reviewStatus) || claimed.has(line.id)) {
      continue;
    }

    const invoice = invoicesById.get(line.invoiceId);

    if (!invoice) {
      continue;
    }

    if (isControlledRounding(line, invoice)) {
      const difference = roundingDifference(line);
      add(
        `rounding:${invoice.supplierId}:${difference.toFixed(2)}`,
        "rounding",
        line,
        roundingSeed(invoice, line, difference)
      );
      claimed.add(line.id);
      continue;
    }

    const repairReason = lineRepairReason(line, invoice);

    if (repairReason) {
      add(`repair:${invoice.id}:${repairReason}`, "repair", line, repairGroup(invoice, [], repairReason));
      claimed.add(line.id);
      continue;
    }

    if (isChargeDescription(line.description)) {
      const title = line.description.replace(/\*/g, " ").replace(/\s+/g, " ").trim();
      add(
        `charge:${invoice.supplierId}:${comparable(title)}`,
        "charge",
        line,
        chargeSeed(invoice, title)
      );
      claimed.add(line.id);
      continue;
    }

    const product = input.products.find((item) => item.id === line.matchedProductId) ?? null;

    if (line.reviewStatus === "needs_review" && line.matchedProductId) {
      const conflict = product
        ? existingLinkConflict({
            description: line.description,
            sku: line.sku,
            unit: line.reviewedUnit ?? line.statedUnit,
            invoiceSupplierId: invoice.supplierId,
            product,
          })
        : "The linked supplier product is not in the catalogue.";
      const ready = conflict == null && product != null;

      add(
        product && ready ? `existing-link:${product.id}` : `existing-link-blocked:${line.id}`,
        "existing_link",
        line,
        existingLinkSeed(invoice, line, product, conflict)
      );
      claimed.add(line.id);
      continue;
    }

    if (
      line.reviewStatus === "price_change" &&
      product &&
      line.matchConfidence === "high" &&
      product.supplierId === invoice.supplierId
    ) {
      const unit = normalizePurchaseUnit(line.reviewedUnit ?? line.statedUnit);
      const price = line.unitPrice == null ? null : roundMoney(line.unitPrice);

      if (unit && price != null && product.purchaseUnit === unit) {
        add(
          `price:${product.id}:${unit}:${price.toFixed(2)}`,
          "historical_price",
          line,
          priceSeed(invoice, line, product, unit, price)
        );
        claimed.add(line.id);
        continue;
      }
    }

    const choices = existingProductChoices(line, invoice, input.products);

    if (choices.length === 1) {
      const chosen = input.products.find((item) => item.id === choices[0].id) ?? null;
      add(
        `product:${choices[0].id}`,
        "existing_product",
        line,
        existingSeed(invoice, line, chosen, choices)
      );
      claimed.add(line.id);
      continue;
    }

    if (choices.length > 1) {
      add(
        `choose:${line.id}`,
        "existing_product",
        line,
        existingSeed(invoice, line, null, choices)
      );
      claimed.add(line.id);
      continue;
    }

    const unit = normalizePurchaseUnit(line.reviewedUnit ?? line.statedUnit);
    const nameKey = cleanInvoiceProductName(line.description) || line.description.trim();
    const skuKey = line.sku?.trim()
      ? `sku:${line.sku.trim().toLowerCase()}`
      : `name:${comparable(nameKey)}`;

    if (!unit) {
      add(
        `unit:${invoice.supplierId}:${skuKey}`,
        "purchase_unit",
        line,
        unitSeed(invoice, line)
      );
      claimed.add(line.id);
      continue;
    }

    const size = readSize(line.description);
    add(
      `new:${invoice.supplierId}:${skuKey}:${unit}:${size.label ?? "nosize"}`,
      "new_material",
      line,
      newMaterialSeed(invoice, line, unit, size, input.products, input.materials)
    );
    claimed.add(line.id);
  }

  for (const bucket of buckets.values()) {
    groups.push(finishGroup(bucket.seed, bucket.lines, invoicesById, input.products));
  }

  const ordered = groups.sort((left, right) => {
    const byKind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    if (byKind !== 0) {
      return byKind;
    }

    return `${left.supplierName} ${left.title}`.localeCompare(`${right.supplierName} ${right.title}`);
  });

  return { groups: ordered, summary: summarise(ordered) };
}

export function existingLinkReviewStatus(
  product: InvoiceMatchProduct,
  unitPrice: number | null,
  unit: string | null
): "processed" | "price_change" | "needs_review" {
  const purchaseUnit = normalizePurchaseUnit(unit);

  if (
    unitPrice == null ||
    purchaseUnit == null ||
    product.currentPrice == null ||
    product.currentPriceUnit == null ||
    purchaseUnit !== product.currentPriceUnit
  ) {
    return "needs_review";
  }

  return moneyMatches(product.currentPrice, unitPrice) ? "processed" : "price_change";
}

export function planBulkDecision(
  groups: readonly BulkReviewGroup[],
  selected: readonly BulkReviewSourceLine[],
  materials: readonly BulkCatalogueMaterial[],
  decision: BulkDecision,
  products: readonly InvoiceMatchProduct[] = []
): BulkPlan {
  if (decision.confirmed !== true) {
    return { ok: false, status: 400, error: "Confirm the decision before it is applied." };
  }

  const lineIds = [...new Set(decision.lineIds)];

  if (lineIds.length === 0) {
    return { ok: false, status: 400, error: "Select at least one invoice line." };
  }

  const selectedById = new Map(selected.map((line) => [line.id, line]));
  const missing = lineIds.filter((id) => !selectedById.has(id));

  if (missing.length > 0) {
    return { ok: false, status: 409, error: "A selected line no longer exists. Reload before applying." };
  }

  const rows = lineIds.map((id) => selectedById.get(id)!);

  if (decision.action === "ignore_charges") {
    return planIgnore(groups, rows);
  }

  if (decision.action === "confirm_product") {
    return planConfirm(groups, rows, decision.productId);
  }

  if (decision.action === "confirm_existing_link") {
    return planConfirmExisting(groups, rows, products, decision.productId);
  }

  if (decision.action === "keep_historical_price") {
    return planKeep(groups, rows);
  }

  if (decision.action === "approve_current_price") {
    return planApprove(groups, rows, decision.approveCurrent);
  }

  if (decision.action === "set_purchase_unit") {
    return planUnit(groups, rows, decision.unit);
  }

  if (decision.action === "accept_rounding") {
    return planRounding(groups, rows, decision.acceptRounding);
  }

  return planCreate(groups, rows, materials, decision);
}

function planIgnore(groups: readonly BulkReviewGroup[], rows: readonly BulkReviewSourceLine[]): BulkPlan {
  const pending = rows.filter((line) => line.reviewStatus !== "ignored");

  if (pending.length === 0) {
    return complete(rows.map((line) => line.id));
  }

  const group = sameGroup(groups, pending, "charge");

  if (!group.ok) {
    return group;
  }

  const changed = pending.filter((line) => line.reviewStatus !== "unmatched" && line.reviewStatus !== "needs_review");

  if (changed.length > 0) {
    return changedError();
  }

  return ready(pending.map((line) => line.id), {
    type: "ignore_charges",
    createIgnoreRule: false,
    createMaterial: false,
    createPrice: false,
  });
}

function planConfirm(
  groups: readonly BulkReviewGroup[],
  rows: readonly BulkReviewSourceLine[],
  productId: string
): BulkPlan {
  const pending = rows.filter((line) => line.matchedProductId !== productId);

  if (pending.length === 0 && rows.every((line) => line.matchedProductId === productId)) {
    return complete(rows.map((line) => line.id));
  }

  const group = sameGroup(groups, pending.length > 0 ? pending : rows, "existing_product");

  if (!group.ok) {
    return group;
  }

  const allowed = new Set(group.group.choices.map((choice) => choice.id));

  if (!productId || !allowed.has(productId)) {
    return {
      ok: false,
      status: 400,
      error: "Choose one catalogue product. Similar dimensions are not selected automatically.",
    };
  }

  if (group.group.choices.length > 1 && group.group.productId === null && pending.length > 1) {
    return {
      ok: false,
      status: 400,
      error: "Choose the catalogue product for one line at a time when more than one material could match.",
    };
  }

  const changed = pending.filter(
    (line) => line.reviewStatus !== "unmatched" && line.reviewStatus !== "needs_review"
  );

  if (changed.length > 0) {
    return changedError();
  }

  return ready(pending.map((line) => line.id), {
    type: "confirm_product",
    productId,
    createMapping: false,
    createPrice: false,
  });
}

function planConfirmExisting(
  groups: readonly BulkReviewGroup[],
  rows: readonly BulkReviewSourceLine[],
  products: readonly InvoiceMatchProduct[],
  productId: string
): BulkPlan {
  const product = products.find((item) => item.id === productId) ?? null;
  const pending = rows.filter((line) => !existingLinkSettled(line, productId, product));

  if (pending.length === 0 && product && rows.every((line) => existingLinkSettled(line, productId, product))) {
    return complete(rows.map((line) => line.id));
  }

  const holders = groups.filter(
    (group) =>
      group.kind === "existing_link" &&
      pending.every((line) => group.lines.some((view) => view.id === line.id))
  );

  if (holders.length !== 1) {
    return { ok: false, status: 400, error: "Selected lines are not in the same review group." };
  }

  const group = holders[0]!;

  if (!group.canApply) {
    return {
      ok: false,
      status: 400,
      error: group.warnings[0] ?? "This existing link cannot be confirmed.",
    };
  }

  if (!product || group.productId !== productId) {
    return { ok: false, status: 409, error: "The catalogue product changed. Reload before applying." };
  }

  for (const line of pending) {
    if (line.matchedProductId !== productId) {
      return {
        ok: false,
        status: 400,
        error: "Confirm the supplier product already linked to this line. A different product is not substituted.",
      };
    }

    if (line.reviewStatus !== "needs_review") {
      return changedError();
    }

    const view = group.lines.find((item) => item.id === line.id);
    const conflict = existingLinkConflict({
      description: line.description,
      sku: line.sku,
      unit: line.reviewedUnit ?? line.statedUnit,
      invoiceSupplierId: view?.supplierId ?? group.supplierId,
      product,
    });

    if (conflict) {
      return { ok: false, status: 400, error: conflict };
    }
  }

  return ready(pending.map((line) => line.id), {
    type: "confirm_existing_link",
    productId,
    createMapping: false,
    createPrice: false,
    createsMaterial: false,
  });
}

function existingLinkSettled(
  line: BulkReviewSourceLine,
  productId: string,
  product: InvoiceMatchProduct | null
) {
  if (!product || line.matchedProductId !== productId || line.matchConfidence !== "high") {
    return false;
  }

  return line.reviewStatus === existingLinkReviewStatus(product, line.unitPrice, line.reviewedUnit ?? line.statedUnit);
}

function planKeep(groups: readonly BulkReviewGroup[], rows: readonly BulkReviewSourceLine[]): BulkPlan {
  const pending = rows.filter((line) => !line.historicalPriceRetained);

  if (pending.length === 0) {
    return complete(rows.map((line) => line.id));
  }

  const group = sameGroup(groups, pending, "historical_price");

  if (!group.ok) {
    return group;
  }

  if (!group.group.productId || group.group.invoicePrice == null || !group.group.currentPriceId) {
    return { ok: false, status: 409, error: "The current catalogue price changed. Reload before applying." };
  }

  const tooNew = pending.filter((line) => {
    const view = group.group.lines.find((item) => item.id === line.id);
    return !view?.olderThanCurrentPrice;
  });

  if (tooNew.length > 0) {
    return {
      ok: false,
      status: 400,
      error: "Only an invoice dated before the current approved price can be recorded as historical.",
    };
  }

  const changed = pending.filter((line) => line.reviewStatus !== "price_change");

  if (changed.length > 0) {
    return changedError();
  }

  return ready(pending.map((line) => line.id), {
    type: "keep_historical_price",
    productId: group.group.productId,
    invoicePrice: group.group.invoicePrice,
    currentPriceId: group.group.currentPriceId,
    changesCurrentPrice: false,
    changesSupplierPreference: false,
    changesQuotes: false,
    createPrice: false,
  });
}

function planApprove(
  groups: readonly BulkReviewGroup[],
  rows: readonly BulkReviewSourceLine[],
  approveCurrent: boolean
): BulkPlan {
  if (approveCurrent !== true) {
    return {
      ok: false,
      status: 400,
      error: "Approving a new current price needs its own confirmation. A repeated invoice price is not approved on its own.",
    };
  }

  const pending = rows.filter((line) => !line.bulkPriceApproved);

  if (pending.length === 0) {
    return complete(rows.map((line) => line.id));
  }

  const group = sameGroup(groups, pending, "historical_price");

  if (!group.ok) {
    return group;
  }

  if (!group.group.productId || group.group.invoicePrice == null || !group.group.currentPriceId) {
    return { ok: false, status: 409, error: "The current catalogue price changed. Reload before applying." };
  }

  const changed = pending.filter((line) => line.reviewStatus !== "price_change");

  if (changed.length > 0) {
    return changedError();
  }

  return ready(pending.map((line) => line.id), {
    type: "approve_current_price",
    productId: group.group.productId,
    invoicePrice: group.group.invoicePrice,
    currentPriceId: group.group.currentPriceId,
    changesCurrentPrice: true,
    priceCount: 1,
    changesSupplierPreference: false,
    changesQuotes: false,
  });
}

function planUnit(
  groups: readonly BulkReviewGroup[],
  rows: readonly BulkReviewSourceLine[],
  unit: string
): BulkPlan {
  if (!isPurchaseUnit(unit)) {
    return {
      ok: false,
      status: 400,
      error: "Choose a purchase unit from the list. BL and PK are not treated as a particular unit.",
    };
  }

  const pending = rows.filter((line) => line.reviewedUnit !== unit);

  if (pending.length === 0) {
    return complete(rows.map((line) => line.id));
  }

  const group = sameGroup(groups, pending, "purchase_unit");

  if (!group.ok) {
    return group;
  }

  const changed = pending.filter(
    (line) => line.reviewStatus !== "unmatched" && line.reviewStatus !== "needs_review"
  );

  if (changed.length > 0) {
    return changedError();
  }

  return ready(pending.map((line) => line.id), {
    type: "set_purchase_unit",
    unit,
    createMaterial: false,
    createPrice: false,
  });
}

function planRounding(
  groups: readonly BulkReviewGroup[],
  rows: readonly BulkReviewSourceLine[],
  acceptRounding: boolean
): BulkPlan {
  if (acceptRounding !== true) {
    return {
      ok: false,
      status: 400,
      error: "Confirm the 1p or 2p difference before it is recorded. The invoice totals stay as extracted.",
    };
  }

  const pending = rows.filter((line) => !line.roundingAccepted);

  if (pending.length === 0) {
    return complete(rows.map((line) => line.id));
  }

  const group = sameGroup(groups, pending, "rounding");

  if (!group.ok) {
    return group;
  }

  if (pending.some((line) => !pennyGap(line))) {
    return {
      ok: false,
      status: 400,
      error: "Only a genuine 1p or 2p difference can be recorded this way.",
    };
  }

  const changed = pending.filter(
    (line) => line.reviewStatus !== "extraction_error" && line.reviewStatus !== "needs_review"
  );

  if (changed.length > 0) {
    return changedError();
  }

  return ready(pending.map((line) => line.id), {
    type: "accept_rounding",
    changesInvoiceTotals: false,
  });
}

function planCreate(
  groups: readonly BulkReviewGroup[],
  rows: readonly BulkReviewSourceLine[],
  materials: readonly BulkCatalogueMaterial[],
  decision: Extract<BulkDecision, { action: "create_material" }>
): BulkPlan {
  const name = cleanInvoiceProductName(decision.name);

  if (!name) {
    return { ok: false, status: 400, error: "Enter a material name. Invoice notes are not used as the name." };
  }

  if (!Number.isFinite(decision.openingPrice) || decision.openingPrice <= 0) {
    return { ok: false, status: 400, error: "The opening price must be greater than zero." };
  }

  const pending = rows.filter((line) => line.reviewStatus !== "processed");

  if (pending.length === 0 && rows.every((line) => line.matchedProductId && line.matchedProductId === rows[0]?.matchedProductId)) {
    return complete(rows.map((line) => line.id));
  }

  const group = sameGroup(groups, pending, "new_material");

  if (!group.ok) {
    return group;
  }

  if (group.group.blockedReason) {
    return { ok: false, status: 400, error: group.group.blockedReason };
  }

  if (!group.group.purchaseUnit) {
    return { ok: false, status: 400, error: "Choose a purchase unit before creating a material." };
  }

  if (group.group.similarMaterials.length > 0 && decision.acknowledgedSimilar !== true) {
    return {
      ok: false,
      status: 400,
      error: "Check the similar catalogue materials before creating a new one.",
    };
  }

  const identity = buildMaterialIdentityKey({
    name,
    thicknessMm: null,
    colour: null,
    finish: null,
    purchaseUnit: group.group.purchaseUnit,
    purchaseWidthMm: group.group.widthMm,
    purchaseHeightMm: group.group.heightMm,
    purchaseLengthMm: group.group.lengthMm,
  });
  const conflict = materials.some(
    (material) =>
      buildMaterialIdentityKey({
        name: material.name,
        thicknessMm: material.thicknessMm,
        colour: material.colour,
        finish: material.finish,
        purchaseUnit: material.purchaseUnit,
        purchaseWidthMm: material.widthMm,
        purchaseHeightMm: material.heightMm,
        purchaseLengthMm: material.lengthMm,
      }) === identity
  );

  if (conflict) {
    return {
      ok: false,
      status: 409,
      error: "A catalogue material with this name and specification already exists. Confirm that product instead of creating another.",
    };
  }

  const changed = pending.filter(
    (line) => line.reviewStatus !== "unmatched" && line.reviewStatus !== "needs_review"
  );

  if (changed.length > 0) {
    return changedError();
  }

  if (!group.group.supplierId) {
    return { ok: false, status: 400, error: "Choose the supplier before creating a material." };
  }

  return ready(pending.map((line) => line.id), {
    type: "create_material",
    name,
    openingPrice: roundMoney(decision.openingPrice),
    unit: group.group.purchaseUnit,
    supplierId: group.group.supplierId,
    sku: group.group.sku,
    widthMm: group.group.widthMm,
    heightMm: group.group.heightMm,
    lengthMm: group.group.lengthMm,
    createMapping: false,
    priceCount: 1,
    preferred: false,
  });
}

function sameGroup(
  groups: readonly BulkReviewGroup[],
  rows: readonly BulkReviewSourceLine[],
  kind: BulkReviewKind
): { ok: true; group: BulkReviewGroup } | { ok: false; status: number; error: string } {
  const found = rows.map((line) => groups.find((group) => group.lines.some((item) => item.id === line.id)) ?? null);

  if (found.some((group) => group == null)) {
    return changedError();
  }

  const unique = [...new Set(found.map((group) => group!.id))];

  if (unique.length !== 1) {
    return {
      ok: false,
      status: 400,
      error: "Selected lines are not in the same review group.",
    };
  }

  const group = found[0]!;

  if (group.kind === "repair" || !group.canApply) {
    return {
      ok: false,
      status: 400,
      error: "This invoice has to be repaired individually. It cannot be bulk-approved.",
    };
  }

  if (group.kind !== kind) {
    return {
      ok: false,
      status: 400,
      error: "This action does not apply to the selected lines.",
    };
  }

  return { ok: true, group };
}

function complete(lineIds: string[]): BulkPlan {
  return {
    ok: true,
    alreadyComplete: true,
    appliesToFutureInvoices: false,
    lineIds,
    write: null,
  };
}

function ready(lineIds: string[], write: Exclude<Extract<BulkPlan, { ok: true }>["write"], null>): BulkPlan {
  return {
    ok: true,
    alreadyComplete: false,
    appliesToFutureInvoices: false,
    lineIds,
    write,
  };
}

function changedError(): { ok: false; status: number; error: string } {
  return {
    ok: false,
    status: 409,
    error: "A selected line changed. Reload before applying.",
  };
}

const KIND_ORDER: Record<BulkReviewKind, number> = {
  repair: 0,
  rounding: 1,
  charge: 2,
  historical_price: 3,
  existing_link: 4,
  existing_product: 5,
  purchase_unit: 6,
  new_material: 7,
};

function summarise(groups: readonly BulkReviewGroup[]): BulkReviewSummary {
  const openLines = groups.flatMap((group) => group.lines);
  const groupedIds = new Set(
    groups
      .filter((group) => group.canApply && group.kind !== "repair" && group.lineCount >= 2)
      .flatMap((group) => group.lines.map((line) => line.id))
  );
  const repairIds = new Set(
    groups.filter((group) => group.kind === "repair").flatMap((group) => group.lines.map((line) => line.id))
  );

  return {
    openLineCount: openLines.length,
    groupedLineCount: groupedIds.size,
    individualLineCount: openLines.filter((line) => !groupedIds.has(line.id) && !repairIds.has(line.id)).length,
    repairLineCount: repairIds.size,
    repairInvoiceCount: groups.filter((group) => group.kind === "repair").length,
  };
}

function finishGroup(
  seed: BulkReviewGroup,
  lines: readonly BulkReviewSourceLine[],
  invoicesById: Map<string, BulkReviewSourceInvoice>,
  products: readonly InvoiceMatchProduct[]
): BulkReviewGroup {
  const views = lines.map((line) => lineView(line, invoicesById.get(line.invoiceId), seed));
  const invoices = uniqueInvoices(views);
  const warnings = [...seed.warnings];

  if (seed.kind === "charge" && views.some((line) => line.invoiceId && invoiceHasTotalWarning(invoicesById.get(line.invoiceId)))) {
    warnings.push("The invoice total still does not add up. Ignoring this charge does not approve the invoice.");
  }

  if (seed.kind === "historical_price" && views.length > 1) {
    warnings.push("This price appears on more than one invoice. That does not approve it as the current price.");
  }

  if (seed.kind === "new_material") {
    const names = new Set(lines.map((line) => cleanInvoiceProductName(line.description)));

    if (names.size > 1) {
      warnings.push("The invoice wording differs. Edit the proposed name. The original invoice text stays on each line.");
    }

    const prices = new Set(lines.map((line) => (line.unitPrice == null ? null : roundMoney(line.unitPrice))));

    if (prices.size > 1) {
      warnings.push("These lines do not all have the same price. Lines with a different invoice price stay on price review.");
    }
  }

  const product = products.find((item) => item.id === seed.productId) ?? null;

  return {
    ...seed,
    warnings: [...new Set(warnings)],
    invoiceCount: invoices.length,
    lineCount: views.length,
    invoices,
    lines: views,
    catalogueMaterial: product?.materialName ?? seed.catalogueMaterial,
    cataloguePrice: product?.currentPrice ?? seed.cataloguePrice,
    sku: sharedValue(lines.map((line) => line.sku?.trim() || null)) ?? seed.sku,
    statedUnit: sharedValue(lines.map((line) => line.statedUnit)) ?? seed.statedUnit,
    invoicePrice: sharedNumber(lines.map((line) => line.unitPrice)),
  };
}

function lineView(
  line: BulkReviewSourceLine,
  invoice: BulkReviewSourceInvoice | undefined,
  seed: BulkReviewGroup
): BulkReviewLineView {
  const older =
    Boolean(invoice?.date) &&
    Boolean(seed.currentEffectiveDate) &&
    (invoice?.date ?? "") < (seed.currentEffectiveDate ?? "");

  return {
    id: line.id,
    invoiceId: line.invoiceId,
    invoiceNumber: invoice?.number ?? null,
    invoiceDate: invoice?.date ?? null,
    description: line.description,
    sku: line.sku,
    quantity: line.quantity,
    statedUnit: line.statedUnit,
    reviewedUnit: line.reviewedUnit,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    reviewStatus: line.reviewStatus,
    olderThanCurrentPrice: older && seed.cataloguePrice != null && line.unitPrice != null && !moneyMatches(seed.cataloguePrice, line.unitPrice),
    supplierId: invoice?.supplierId ?? null,
  };
}

function repairGroup(invoice: BulkReviewSourceInvoice, _lines: BulkReviewSourceLine[], reason: string): BulkReviewGroup {
  return baseGroup({
    id: `repair:${invoice.id}:${reason}`,
    kind: "repair",
    invoice,
    title: invoice.number ? `Invoice ${invoice.number}` : "Invoice without a number",
    proposedAction: "Repair this invoice individually. Bulk approval is not available.",
    warnings: [reason],
    canApply: false,
  });
}

function visibleRepair(invoice: BulkReviewSourceInvoice, reasons: string[]): BulkReviewGroup {
  const totalWarning = hasUnresolvedInvoiceTotalWarning(reasons);

  return {
    ...repairGroup(invoice, [], reasons[0] ?? "This invoice needs repair."),
    warnings: reasons.filter(Boolean),
    invoiceCount: 1,
    invoices: [{ id: invoice.id, number: invoice.number, date: invoice.date }],
    subtotal: invoice.subtotal,
    vat: invoice.vat,
    total: invoice.total,
    proposedAction: totalWarning
      ? "Repair the invoice total on the invoice page. This warning stays until the totals are repaired."
      : "Repair this invoice individually. Bulk approval is not available.",
  };
}

function chargeSeed(invoice: BulkReviewSourceInvoice, title: string): BulkReviewGroup {
  return baseGroup({
    id: `charge:${invoice.supplierId}:${comparable(title)}`,
    kind: "charge",
    invoice,
    title,
    proposedAction: "Confirm the selected lines are non-material charges. Invoice totals and the original text stay as extracted.",
    warnings: [],
    canApply: true,
  });
}

function priceSeed(
  invoice: BulkReviewSourceInvoice,
  line: BulkReviewSourceLine,
  product: InvoiceMatchProduct,
  unit: PurchaseUnit,
  price: number
): BulkReviewGroup {
  return baseGroup({
    id: `price:${product.id}:${unit}:${price.toFixed(2)}`,
    kind: "historical_price",
    invoice,
    title: product.materialName,
    proposedAction:
      "Record the historical invoice price, or explicitly approve a new current price. A repeated invoice price is not approved on its own.",
    warnings: [],
    canApply: true,
    productId: product.id,
    purchaseUnit: unit,
    catalogueMaterial: product.materialName,
    cataloguePrice: product.currentPrice,
    currentPriceId: product.currentPriceId ?? null,
    currentEffectiveDate: product.currentEffectiveDate ?? null,
    invoicePrice: price,
    sku: line.sku,
    choices: [choiceFromProduct(product)],
  });
}

function existingLinkSeed(
  invoice: BulkReviewSourceInvoice,
  line: BulkReviewSourceLine,
  product: InvoiceMatchProduct | null,
  conflict: string | null
): BulkReviewGroup {
  return baseGroup({
    id: product ? `existing-link:${product.id}` : `existing-link-blocked:${line.id}`,
    kind: "existing_link",
    invoice,
    title: product?.materialName ?? cleanInvoiceProductName(line.description),
    proposedAction: conflict
      ? conflict
      : "Confirm the supplier product already linked to the selected lines. A matching price closes the line. A different price stays for a price decision. No future invoice rule is created.",
    warnings: conflict ? [conflict] : [],
    canApply: conflict == null && product != null,
    productId: product?.id ?? null,
    choices: product ? [choiceFromProduct(product)] : [],
    purchaseUnit: product?.purchaseUnit ?? null,
    catalogueMaterial: product?.materialName ?? null,
    cataloguePrice: product?.currentPrice ?? null,
    currentPriceId: product?.currentPriceId ?? null,
    currentEffectiveDate: product?.currentEffectiveDate ?? null,
    sku: line.sku,
  });
}

function existingSeed(
  invoice: BulkReviewSourceInvoice,
  line: BulkReviewSourceLine,
  product: InvoiceMatchProduct | null,
  choices: BulkProductChoice[]
): BulkReviewGroup {
  const several = choices.length > 1;

  return baseGroup({
    id: product ? `product:${product.id}` : `choose:${line.id}`,
    kind: "existing_product",
    invoice,
    title: product?.materialName ?? cleanInvoiceProductName(line.description),
    proposedAction: several
      ? "Choose one catalogue product. Similar dimensions are not selected automatically."
      : "Confirm the existing catalogue product for the selected lines. A different invoice price stays on price review.",
    warnings: several ? ["More than one catalogue product could match. None has been selected."] : [],
    canApply: true,
    productId: product?.id ?? null,
    choices,
    purchaseUnit: product?.purchaseUnit ?? null,
    catalogueMaterial: product?.materialName ?? null,
    cataloguePrice: product?.currentPrice ?? null,
    currentPriceId: product?.currentPriceId ?? null,
    currentEffectiveDate: product?.currentEffectiveDate ?? null,
    sku: line.sku,
  });
}

function unitSeed(invoice: BulkReviewSourceInvoice, line: BulkReviewSourceLine): BulkReviewGroup {
  const size = readSize(line.description);
  const suggestedUnit = suggestedPurchaseUnit(line);
  const warnings = [
    purchaseUnitGuidance({
      statedUnit: line.statedUnit,
      unit: suggestedUnit,
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      lengthMm: size.lengthMm,
      price: line.unitPrice,
    }),
  ];

  if (suggestedUnit === "litre") {
    warnings.push(
      "The description gives the quantity in litres. Confirm litre before saving. The price stays per litre and is not converted."
    );
  }

  if (!size.label) {
    warnings.push("The sheet or roll size was not read. Do not copy the size from another line.");
  }

  if (size.ambiguousSlit) {
    warnings.push("The slit width is not a single clear width.");
  }

  return baseGroup({
    id: `unit:${invoice.supplierId}:${line.id}`,
    kind: "purchase_unit",
    invoice,
    title: cleanInvoiceProductName(line.description) || line.description,
    proposedAction: "Choose a purchase unit from the catalogue list. This does not create a material or change a price.",
    warnings,
    canApply: true,
    sku: line.sku,
    statedUnit: line.statedUnit,
    suggestedUnit,
    widthMm: size.ambiguousSlit ? null : size.widthMm,
    heightMm: size.heightMm,
    lengthMm: size.lengthMm,
    dimensions: size.label,
  });
}

function newMaterialSeed(
  invoice: BulkReviewSourceInvoice,
  line: BulkReviewSourceLine,
  unit: PurchaseUnit,
  size: SizeRead,
  products: readonly InvoiceMatchProduct[],
  materials: readonly BulkCatalogueMaterial[]
): BulkReviewGroup {
  const warnings: string[] = [];
  let blockedReason: string | null = null;
  const sku = line.sku?.trim().toLowerCase() ?? "";
  const skuHits = sku
    ? products.filter(
        (product) => product.supplierId === invoice.supplierId && product.sku?.trim().toLowerCase() === sku
      )
    : [];

  if (skuHits.length > 0) {
    blockedReason = `SKU ${line.sku} already belongs to ${skuHits.map((product) => product.materialName).join(", ")}. Confirm that product instead of creating another.`;
  }

  if (size.slit) {
    warnings.push("This width is a slit width. It is not matched to the master roll, and products are not merged on width alone.");
  }

  if (size.ambiguousSlit) {
    blockedReason = "The slit width is not a single clear width, so this product cannot be created in bulk.";
  }

  if (!size.label) {
    warnings.push("The sheet or roll size was not read. Do not copy the size from another line.");
  }

  const similar = materials.filter((material) => sameSize(material, unit, size));

  if (similar.length > 0) {
    warnings.push("Catalogue materials already use this size. Dimensions on their own are not a match.");
  }

  return baseGroup({
    id: `new:${invoice.supplierId}:${line.id}`,
    kind: "new_material",
    invoice,
    title: cleanInvoiceProductName(line.description) || line.description,
    proposedAction: "Create one catalogue material for the selected lines after checking the existing catalogue.",
    warnings,
    canApply: blockedReason == null,
    blockedReason,
    proposedName: cleanInvoiceProductName(line.description),
    purchaseUnit: unit,
    sku: line.sku,
    widthMm: size.ambiguousSlit ? null : size.widthMm,
    heightMm: size.heightMm,
    lengthMm: size.lengthMm,
    dimensions: size.label,
    similarMaterials: similar.map((material) => ({ id: material.id, name: material.name })),
  });
}

function baseGroup(input: {
  id: string;
  kind: BulkReviewKind;
  invoice: BulkReviewSourceInvoice;
  title: string;
  proposedAction: string;
  warnings: string[];
  canApply: boolean;
  productId?: string | null;
  choices?: BulkProductChoice[];
  purchaseUnit?: PurchaseUnit | null;
  catalogueMaterial?: string | null;
  cataloguePrice?: number | null;
  currentPriceId?: string | null;
  currentEffectiveDate?: string | null;
  invoicePrice?: number | null;
  sku?: string | null;
  statedUnit?: string | null;
  proposedName?: string | null;
  widthMm?: number | null;
  heightMm?: number | null;
  lengthMm?: number | null;
  dimensions?: string | null;
  similarMaterials?: Array<{ id: string; name: string }>;
  blockedReason?: string | null;
  suggestedUnit?: PurchaseUnit | null;
}): BulkReviewGroup {
  return {
    id: input.id,
    kind: input.kind,
    supplierId: input.invoice.supplierId,
    supplierName: input.invoice.supplierName ?? "No supplier",
    title: input.title,
    invoiceCount: 0,
    lineCount: 0,
    invoices: [],
    sku: input.sku ?? null,
    dimensions: input.dimensions ?? null,
    statedUnit: input.statedUnit ?? null,
    purchaseUnit: input.purchaseUnit ?? null,
    suggestedUnit: input.suggestedUnit ?? null,
    catalogueMaterial: input.catalogueMaterial ?? null,
    cataloguePrice: input.cataloguePrice ?? null,
    currentPriceId: input.currentPriceId ?? null,
    currentEffectiveDate: input.currentEffectiveDate ?? null,
    invoicePrice: input.invoicePrice ?? null,
    proposedAction: input.proposedAction,
    warnings: input.warnings.filter(Boolean),
    canApply: input.canApply,
    lines: [],
    productId: input.productId ?? null,
    choices: input.choices ?? [],
    proposedName: input.proposedName ?? null,
    widthMm: input.widthMm ?? null,
    heightMm: input.heightMm ?? null,
    lengthMm: input.lengthMm ?? null,
    similarMaterials: input.similarMaterials ?? [],
    blockedReason: input.blockedReason ?? null,
    subtotal: null,
    vat: null,
    total: null,
  };
}

function lineRepairReason(line: BulkReviewSourceLine, invoice: BulkReviewSourceInvoice) {
  if (!invoice.supplierId) {
    return "The invoice has no supplier. Choose the supplier before reviewing the line.";
  }

  if (invoice.extractionStatus !== "extracted") {
    return "The invoice text could not be read.";
  }

  if (invoice.extractionWarnings.some((warning) => /no invoice lines/i.test(warning))) {
    return "No invoice lines could be read from this invoice.";
  }

  if (line.reviewStatus === "query") {
    return "This line is already queried and stays an individual decision.";
  }

  if (line.mathsWarning || line.reviewStatus === "extraction_error") {
    if (pennyGap(line)) {
      return null;
    }

    return line.mathsWarning ?? "The quantity or line total is not reliable, so it cannot be bulk-approved.";
  }

  if (line.quantity == null || line.quantity <= 0 || line.unitPrice == null) {
    return "The quantity or unit price is missing, so it cannot be bulk-approved.";
  }

  return null;
}

function existingProductChoices(
  line: BulkReviewSourceLine,
  invoice: BulkReviewSourceInvoice,
  products: readonly InvoiceMatchProduct[]
) {
  const unit = normalizePurchaseUnit(line.reviewedUnit ?? line.statedUnit);

  if (!invoice.supplierId || !unit) {
    return [];
  }

  const text = comparable(line.description);
  const matches = products.filter((product) => {
    if (product.supplierId !== invoice.supplierId || product.purchaseUnit !== unit) {
      return false;
    }

    if (invoiceWidthConflicts(line.description, product)) {
      return false;
    }

    const sku = line.sku?.trim().toLowerCase() ?? "";
    const productSku = product.sku?.trim().toLowerCase() ?? "";

    if (sku && productSku && sku === productSku) {
      return true;
    }

    const productText = comparable(product.description);
    return productText.length >= 12 && (text.startsWith(productText) || productText.startsWith(text));
  });

  return matches.map(choiceFromProduct);
}

function choiceFromProduct(product: InvoiceMatchProduct): BulkProductChoice {
  return {
    id: product.id,
    materialName: product.materialName,
    description: product.description,
    purchaseUnit: product.purchaseUnit,
    currentPrice: product.currentPrice,
    dimensions: dimensionText(product.widthMm, product.heightMm, product.lengthMm),
  };
}

function readSize(description: string): SizeRead {
  const slit = [...description.matchAll(/\bslit to\s+(\d{3,4}(?:\.\d+)?)\s*mm\b/gi)]
    .map((match) => Math.round(Number(match[1])))
    .filter((value) => Number.isFinite(value));
  const uniqueSlit = [...new Set(slit)];
  const sheet = reliableSheetSize(description);
  const roll = reliableRollSize(description);

  if (/\bslit\b/i.test(description) && uniqueSlit.length !== 1) {
    return {
      widthMm: null,
      heightMm: null,
      lengthMm: roll?.lengthMm ?? null,
      label: "Slit width was not read as one width",
      slit: true,
      ambiguousSlit: true,
    };
  }

  if (uniqueSlit.length === 1) {
    const lengthMm = roll?.lengthMm ?? null;
    return {
      widthMm: uniqueSlit[0],
      heightMm: null,
      lengthMm,
      label: lengthMm == null ? `Slit to ${uniqueSlit[0]} mm` : `Slit to ${uniqueSlit[0]} mm × ${lengthMm / 1000} m`,
      slit: true,
      ambiguousSlit: false,
    };
  }

  if (sheet && roll) {
    return {
      widthMm: null,
      heightMm: null,
      lengthMm: null,
      label: "More than one size was read",
      slit: false,
      ambiguousSlit: false,
    };
  }

  if (sheet) {
    return {
      widthMm: sheet.widthMm,
      heightMm: sheet.heightMm,
      lengthMm: null,
      label: `${sheet.widthMm} × ${sheet.heightMm} mm`,
      slit: false,
      ambiguousSlit: false,
    };
  }

  if (roll) {
    return {
      widthMm: roll.widthMm,
      heightMm: null,
      lengthMm: roll.lengthMm,
      label: `${roll.widthMm} mm × ${roll.lengthMm / 1000} m`,
      slit: false,
      ambiguousSlit: false,
    };
  }

  return {
    widthMm: null,
    heightMm: null,
    lengthMm: null,
    label: null,
    slit: false,
    ambiguousSlit: false,
  };
}

function sameSize(material: BulkCatalogueMaterial, unit: PurchaseUnit, size: SizeRead) {
  if (material.purchaseUnit !== unit || size.ambiguousSlit) {
    return false;
  }

  if (size.widthMm == null) {
    return false;
  }

  return (
    Math.round(material.widthMm ?? -1) === Math.round(size.widthMm) &&
    Math.round(material.heightMm ?? -1) === Math.round(size.heightMm ?? -1) &&
    Math.round(material.lengthMm ?? -1) === Math.round(size.lengthMm ?? -1)
  );
}

function isChargeDescription(description: string) {
  const text = description.replace(/\*/g, " ").replace(/\s+/g, " ").trim();

  if (reliableSheetSize(text) || reliableRollSize(text) || /\bslit to\b/i.test(text) || /\d{3,4}\s*mm\b/i.test(text)) {
    return false;
  }

  if (MATERIAL_WORD.test(text)) {
    return false;
  }

  return CHARGE_PATTERN.test(text);
}

function roundingSeed(invoice: BulkReviewSourceInvoice, line: BulkReviewSourceLine, difference: number): BulkReviewGroup {
  const expected = roundMoney((line.quantity ?? 0) * (line.unitPrice ?? 0));
  const actual = roundMoney(line.lineTotal ?? 0);

  return baseGroup({
    id: `rounding:${invoice.supplierId}:${difference.toFixed(2)}`,
    kind: "rounding",
    invoice,
    title: difference === 0.01 ? "1p rounding difference" : "2p rounding difference",
    proposedAction:
      "Record the difference between quantity × unit price and the invoice line total. The invoice figures stay as extracted.",
    warnings: [
      `Quantity × unit price is ${formatGbp(expected)}. The invoice line total is ${formatGbp(actual)}.`,
    ],
    canApply: true,
  });
}

function isControlledRounding(line: BulkReviewSourceLine, invoice: BulkReviewSourceInvoice) {
  if (line.roundingAccepted || !pennyGap(line) || !invoice.supplierId) {
    return false;
  }

  if (invoice.extractionStatus !== "extracted" || line.reviewStatus === "query") {
    return false;
  }

  if (invoice.extractionWarnings.some((warning) => /no invoice lines/i.test(warning))) {
    return false;
  }

  return line.reviewStatus === "extraction_error" || line.reviewStatus === "needs_review" || Boolean(line.mathsWarning);
}

function suggestedPurchaseUnit(line: BulkReviewSourceLine): PurchaseUnit | null {
  if (normalizePurchaseUnit(line.statedUnit)) {
    return null;
  }

  if (/\b(?:litre|liter|litres|liters)\b/i.test(line.description)) {
    return "litre";
  }

  return null;
}

function roundingDifference(line: BulkReviewSourceLine) {
  const expected = roundMoney((line.quantity ?? 0) * (line.unitPrice ?? 0));
  return roundMoney(Math.abs(expected - roundMoney(line.lineTotal ?? 0)));
}

function pennyGap(line: BulkReviewSourceLine) {
  if (line.quantity == null || line.unitPrice == null || line.lineTotal == null) {
    return false;
  }

  const expected = roundMoney(line.quantity * line.unitPrice);
  const difference = Math.abs(expected - roundMoney(line.lineTotal));
  return difference > 0 && difference <= 0.02;
}

function comparable(value: string) {
  return normalizeSupplierDescription(value).replace(/[μµ]/g, "u");
}

function dimensionText(width: number | null, height: number | null, length: number | null) {
  if (width != null && height != null) {
    return `${width} × ${height} mm`;
  }

  if (width != null && length != null) {
    return `${width} mm × ${length / 1000} m`;
  }

  return "Size not recorded";
}

function uniqueInvoices(lines: readonly BulkReviewLineView[]) {
  const invoices = new Map<string, { id: string; number: string | null; date: string | null }>();

  for (const line of lines) {
    invoices.set(line.invoiceId, {
      id: line.invoiceId,
      number: line.invoiceNumber,
      date: line.invoiceDate,
    });
  }

  return [...invoices.values()].sort((left, right) => (left.date ?? "").localeCompare(right.date ?? ""));
}

function sharedValue(values: Array<string | null>) {
  const present = [...new Set(values.filter((value): value is string => Boolean(value)))];
  return present.length === 1 ? present[0] : null;
}

function sharedNumber(values: Array<number | null>) {
  const present = values.map((value) => (value == null ? null : roundMoney(value)));

  if (present.some((value) => value == null) || new Set(present).size !== 1) {
    return null;
  }

  return present[0];
}

function invoiceHasTotalWarning(invoice: BulkReviewSourceInvoice | undefined) {
  return hasUnresolvedInvoiceTotalWarning(invoice?.extractionWarnings ?? []);
}
