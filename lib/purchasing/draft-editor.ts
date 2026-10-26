export const PURCHASE_ORDER_VAT_TREATMENTS = [
  "standard",
  "zero_rated",
  "exempt",
  "reverse_charge",
  "outside_scope",
] as const;

export type PurchaseOrderVatTreatment =
  (typeof PURCHASE_ORDER_VAT_TREATMENTS)[number];

export type EditorAllocation = {
  key: string;
  target: "job" | "stock";
  jobId: string;
  quantity: string;
};

export type EditorLine = {
  key: string;
  lineId: string | null;
  lineKind: "catalogue" | "manual";
  materialId: string | null;
  productId: string | null;
  priceId: string | null;
  description: string;
  supplierSku: string;
  unit: string;
  quantity: string;
  unitPriceExVat: string;
  vatTreatment: string;
  allocations: EditorAllocation[];
};

export type EditorDeliveryAllocation = {
  key: string;
  target: "job" | "stock";
  jobId: string;
  amountExVat: string;
};

export type EditorDraft = {
  supplierOrdersEmail: string;
  vatTreatment: PurchaseOrderVatTreatment;
  deliveryMethod: "workshop" | "custom";
  deliveryRecipient: string;
  deliveryLine1: string;
  deliveryLine2: string;
  deliveryCity: string;
  deliveryCounty: string;
  deliveryPostcode: string;
  deliveryCountry: string;
  deliveryInstructions: string;
  deliveryDate: string;
  deliveryChargeExVat: string;
  deliveryChargeMethod: "proportional" | "manual";
  lines: EditorLine[];
  deliveryAllocations: EditorDeliveryAllocation[];
  vatRate: number;
};

export type DraftTotals = {
  goodsExVat: number;
  deliveryExVat: number;
  subtotalExVat: number;
  vatTotal: number;
  totalIncVat: number;
};

const LINE_KEYS = [
  "lineKind",
  "materialId",
  "productId",
  "priceId",
  "description",
  "supplierSku",
  "unit",
  "quantity",
  "unitPriceExVat",
  "vatTreatment",
  "allocations",
] as const;

const REQUIRED_PAYLOAD_KEYS = [
  "supplierOrdersEmail",
  "vatTreatment",
  "deliveryMethod",
  "deliveryRecipient",
  "deliveryLine1",
  "deliveryLine2",
  "deliveryCity",
  "deliveryCounty",
  "deliveryPostcode",
  "deliveryCountry",
  "deliveryInstructions",
  "deliveryDate",
  "deliveryChargeExVat",
  "deliveryChargeMethod",
  "lines",
  "deliveryAllocations",
] as const;

export function emptyManualLine(key: string): EditorLine {
  return {
    key,
    lineId: null,
    lineKind: "manual",
    materialId: null,
    productId: null,
    priceId: null,
    description: "",
    supplierSku: "",
    unit: "",
    quantity: "1",
    unitPriceExVat: "",
    vatTreatment: "",
    allocations: [],
  };
}

export function emptyCatalogueLine(key: string): EditorLine {
  return {
    ...emptyManualLine(key),
    lineKind: "catalogue",
  };
}

export function validateDraft(draft: EditorDraft) {
  if (!PURCHASE_ORDER_VAT_TREATMENTS.includes(draft.vatTreatment)) {
    return "VAT treatment is not supported.";
  }

  if (draft.supplierOrdersEmail.trim()) {
    const email = draft.supplierOrdersEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Supplier email is not valid.";
    }
  }

  const charge = parseDecimal(draft.deliveryChargeExVat, 2);
  if (charge === null || charge < 0) {
    return "Delivery charge cannot be negative.";
  }

  if (
    draft.deliveryMethod === "custom" &&
    (!draft.deliveryLine1.trim() || !draft.deliveryPostcode.trim())
  ) {
    return "Custom delivery needs an address line and a postcode.";
  }

  if (
    draft.deliveryChargeMethod === "proportional" &&
    draft.deliveryAllocations.length > 0
  ) {
    return "Proportional delivery is calculated when the draft is saved.";
  }

  if (draft.deliveryDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(draft.deliveryDate.trim())) {
    return "Delivery date must be a date.";
  }

  const goodsTargets = new Set<string>();

  for (const [index, line] of draft.lines.entries()) {
    const label = `Line ${index + 1}`;
    const quantity = parseDecimal(line.quantity, 4);
    if (quantity === null || quantity <= 0) {
      return `${label} quantity must be greater than zero.`;
    }

    if (line.vatTreatment && !isVatTreatment(line.vatTreatment)) {
      return `${label} VAT treatment is not supported.`;
    }

    if (line.lineKind === "catalogue") {
      if (!line.materialId || !line.productId || !line.priceId) {
        return `${label} needs a catalogue product.`;
      }
    } else {
      const price = parseDecimal(line.unitPriceExVat, 4);
      if (!line.description.trim() || !line.unit.trim() || price === null || price <= 0) {
        return `${label} needs a description, unit and price.`;
      }
    }

    const lineTotal = roundMoney(
      quantity *
        (line.lineKind === "catalogue"
          ? parseDecimal(line.unitPriceExVat, 4) ?? 0
          : parseDecimal(line.unitPriceExVat, 4) ?? 0)
    );
    if (lineTotal <= 0) {
      return `${label} rounds to zero.`;
    }

    const seen = new Set<string>();
    for (const allocation of line.allocations) {
      const allocated = parseDecimal(allocation.quantity, 4);
      if (allocated === null || allocated <= 0) {
        return `${label} allocation quantity must be greater than zero.`;
      }

      const token =
        allocation.target === "stock"
          ? "stock"
          : allocation.target === "job"
            ? allocation.jobId
            : "";
      if (allocation.target === "job" && !allocation.jobId) {
        return `${label} job allocation needs a job.`;
      }
      if (allocation.target === "stock" && allocation.jobId) {
        return "Stock allocation cannot reference a job.";
      }
      if (!token || seen.has(token)) {
        return `${label} repeats an allocation target.`;
      }
      seen.add(token);
      goodsTargets.add(token);
    }
  }

  if (draft.deliveryChargeMethod === "manual") {
    const seen = new Set<string>();
    for (const allocation of draft.deliveryAllocations) {
      const amount = parseDecimal(allocation.amountExVat, 2);
      if (amount === null || amount < 0) {
        return "Delivery allocation cannot be negative.";
      }
      const token =
        allocation.target === "stock"
          ? "stock"
          : allocation.target === "job"
            ? allocation.jobId
            : "";
      if (allocation.target === "job" && !allocation.jobId) {
        return "Delivery allocation needs a job.";
      }
      if (!token || seen.has(token)) {
        return "Delivery allocation repeats a target.";
      }
      if (!goodsTargets.has(token)) {
        return "Delivery can only be allocated to jobs or stock that are receiving goods.";
      }
      seen.add(token);
    }
  }

  return null;
}

export function buildPurchaseOrderDraftPayload(draft: EditorDraft) {
  const charge = parseDecimal(draft.deliveryChargeExVat, 2) ?? 0;

  return {
    supplierOrdersEmail: optionalText(draft.supplierOrdersEmail),
    vatTreatment: draft.vatTreatment,
    deliveryMethod: draft.deliveryMethod,
    deliveryRecipient:
      draft.deliveryMethod === "custom" ? optionalText(draft.deliveryRecipient) : null,
    deliveryLine1:
      draft.deliveryMethod === "custom" ? optionalText(draft.deliveryLine1) : null,
    deliveryLine2:
      draft.deliveryMethod === "custom" ? optionalText(draft.deliveryLine2) : null,
    deliveryCity:
      draft.deliveryMethod === "custom" ? optionalText(draft.deliveryCity) : null,
    deliveryCounty:
      draft.deliveryMethod === "custom" ? optionalText(draft.deliveryCounty) : null,
    deliveryPostcode:
      draft.deliveryMethod === "custom" ? optionalText(draft.deliveryPostcode) : null,
    deliveryCountry: optionalText(draft.deliveryCountry) ?? "United Kingdom",
    deliveryInstructions: optionalText(draft.deliveryInstructions),
    deliveryDate: optionalText(draft.deliveryDate),
    deliveryChargeExVat: charge,
    deliveryChargeMethod: draft.deliveryChargeMethod,
    lines: draft.lines.map((line) => {
      const quantity = parseDecimal(line.quantity, 4) ?? 0;
      const price = parseDecimal(line.unitPriceExVat, 4);
      const vat =
        line.vatTreatment && line.vatTreatment !== draft.vatTreatment
          ? line.vatTreatment
          : null;

      return {
        lineKind: line.lineKind,
        materialId: line.lineKind === "catalogue" ? line.materialId : null,
        productId: line.lineKind === "catalogue" ? line.productId : null,
        priceId: line.lineKind === "catalogue" ? line.priceId : null,
        description: optionalText(line.description),
        supplierSku: optionalText(line.supplierSku),
        unit: optionalText(line.unit),
        quantity,
        unitPriceExVat: line.lineKind === "manual" ? price : price,
        vatTreatment: vat,
        allocations: line.allocations.map((allocation) => ({
          target: allocation.target,
          jobId: allocation.target === "job" ? allocation.jobId : null,
          quantity: parseDecimal(allocation.quantity, 4),
        })),
      };
    }),
    deliveryAllocations:
      draft.deliveryChargeMethod === "manual"
        ? draft.deliveryAllocations.map((allocation) => ({
            target: allocation.target,
            jobId: allocation.target === "job" ? allocation.jobId : null,
            amountExVat: parseDecimal(allocation.amountExVat, 2),
          }))
        : [],
  };
}

export function payloadFieldNames(payload: ReturnType<typeof buildPurchaseOrderDraftPayload>) {
  return {
    root: Object.keys(payload).sort(),
    line: payload.lines[0] ? Object.keys(payload.lines[0]).sort() : [...LINE_KEYS].sort(),
    required: [...REQUIRED_PAYLOAD_KEYS].sort(),
  };
}

export function estimateDraftTotals(draft: EditorDraft): DraftTotals {
  const rate = Number.isFinite(draft.vatRate) ? draft.vatRate : 0.2;
  let goods = 0;
  const groups = new Map<string, number>();

  for (const line of draft.lines) {
    const quantity = parseDecimal(line.quantity, 4);
    const price = parseDecimal(line.unitPriceExVat, 4);
    if (quantity === null || price === null || quantity <= 0 || price <= 0) {
      continue;
    }
    const total = roundMoney(quantity * price);
    if (total <= 0) {
      continue;
    }
    goods = roundMoney(goods + total);
    const treatment =
      line.vatTreatment && line.vatTreatment !== draft.vatTreatment
        ? line.vatTreatment
        : draft.vatTreatment;
    groups.set(treatment, roundMoney((groups.get(treatment) ?? 0) + total));
  }

  const delivery = parseDecimal(draft.deliveryChargeExVat, 2) ?? 0;
  const mixed = [...groups.keys()].some((treatment) => treatment !== draft.vatTreatment);
  let vat = 0;
  if (!mixed) {
    vat = vatAmount(draft.vatTreatment, roundMoney(goods + delivery), rate);
  } else {
    for (const [treatment, net] of groups) {
      vat = roundMoney(vat + vatAmount(treatment, net, rate));
    }
    vat = roundMoney(vat + vatAmount(draft.vatTreatment, delivery, rate));
  }

  return {
    goodsExVat: goods,
    deliveryExVat: delivery,
    subtotalExVat: roundMoney(goods + delivery),
    vatTotal: vat,
    totalIncVat: roundMoney(goods + delivery + vat),
  };
}

export function readDraftTotals(data: unknown): DraftTotals | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const record = data as Record<string, unknown>;
  const goodsExVat = money(record.goodsExVat);
  const deliveryExVat = money(record.deliveryExVat);
  const subtotalExVat = money(record.subtotalExVat);
  const vatTotal = money(record.vatTotal);
  const totalIncVat = money(record.totalIncVat);
  if (
    goodsExVat === null ||
    deliveryExVat === null ||
    subtotalExVat === null ||
    vatTotal === null ||
    totalIncVat === null
  ) {
    return null;
  }
  return { goodsExVat, deliveryExVat, subtotalExVat, vatTotal, totalIncVat };
}

export function applySavedDraft(
  draft: EditorDraft,
  saved: {
    supplierOrdersEmail: string | null;
    lines: EditorLine[];
    deliveryAllocations: EditorDeliveryAllocation[];
  }
): EditorDraft {
  return {
    ...draft,
    supplierOrdersEmail: saved.supplierOrdersEmail ?? "",
    lines: saved.lines.map((line) => ({
      ...line,
      key: line.lineId ?? line.key,
    })),
    deliveryAllocations:
      draft.deliveryChargeMethod === "proportional" ? [] : saved.deliveryAllocations,
  };
}

export function saveDraftErrorMessage(error: {
  code?: string;
  message?: string;
} | null) {
  const message = error?.message?.trim() ?? "";
  const lower = message.toLowerCase();

  if (
    !message ||
    lower.startsWith("permission denied") ||
    message === "Purchase orders must be changed through purchasing functions"
  ) {
    return "The draft could not be saved.";
  }

  if (message === "You do not have permission to issue purchase orders") {
    return "You do not have permission to save this purchase order.";
  }

  return message;
}

export function editorLineFromDatabase(row: {
  id?: unknown;
  line_kind?: unknown;
  material_id?: unknown;
  material_supplier_product_id?: unknown;
  material_price_id?: unknown;
  description?: unknown;
  supplier_sku?: unknown;
  unit?: unknown;
  quantity?: unknown;
  unit_price_ex_vat?: unknown;
  vat_treatment?: unknown;
  purchase_order_allocations?: unknown;
}): EditorLine | null {
  if (typeof row.id !== "string") {
    return null;
  }
  if (row.line_kind !== "catalogue" && row.line_kind !== "manual") {
    return null;
  }

  const allocations = Array.isArray(row.purchase_order_allocations)
    ? row.purchase_order_allocations.flatMap((entry) => {
        const allocation = editorAllocationFromDatabase(entry);
        return allocation ? [allocation] : [];
      })
    : [];

  return {
    key: row.id,
    lineId: row.id,
    lineKind: row.line_kind,
    materialId: textOrNull(row.material_id),
    productId: textOrNull(row.material_supplier_product_id),
    priceId: textOrNull(row.material_price_id),
    description: typeof row.description === "string" ? row.description : "",
    supplierSku: typeof row.supplier_sku === "string" ? row.supplier_sku : "",
    unit: typeof row.unit === "string" ? row.unit : "",
    quantity: decimalText(row.quantity as string | number | null),
    unitPriceExVat: decimalText(row.unit_price_ex_vat as string | number | null),
    vatTreatment: typeof row.vat_treatment === "string" ? row.vat_treatment : "",
    allocations,
  };
}

export function editorDeliveryFromDatabase(row: {
  id?: unknown;
  target?: unknown;
  job_id?: unknown;
  amount_ex_vat?: unknown;
}): EditorDeliveryAllocation | null {
  if (row.target !== "job" && row.target !== "stock") {
    return null;
  }
  const key = typeof row.id === "string" ? row.id : `${row.target}:${textOrNull(row.job_id) ?? "stock"}`;
  return {
    key,
    target: row.target,
    jobId: textOrNull(row.job_id) ?? "",
    amountExVat: decimalText(row.amount_ex_vat as string | number | null),
  };
}

export function decimalText(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  return numeric.toFixed(4).replace(/\.?0+$/, "");
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseDecimal(value: string, scale: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const factor = 10 ** scale;
  if (Math.abs(numeric * factor - Math.round(numeric * factor)) > 1e-8) {
    return null;
  }
  return numeric;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function vatAmount(treatment: string, net: number, rate: number) {
  if (treatment === "standard") {
    return roundMoney(net * rate);
  }
  return 0;
}

function money(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function editorAllocationFromDatabase(value: unknown): EditorAllocation | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as {
    id?: unknown;
    target?: unknown;
    job_id?: unknown;
    quantity?: unknown;
  };
  if (row.target !== "job" && row.target !== "stock") {
    return null;
  }
  const jobId = textOrNull(row.job_id) ?? "";
  return {
    key: typeof row.id === "string" ? row.id : `${row.target}:${jobId || "stock"}`,
    target: row.target,
    jobId,
    quantity: decimalText(row.quantity as string | number | null),
  };
}

function textOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function isVatTreatment(value: string): value is PurchaseOrderVatTreatment {
  return PURCHASE_ORDER_VAT_TREATMENTS.includes(value as PurchaseOrderVatTreatment);
}
