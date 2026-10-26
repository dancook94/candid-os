import type { SupabaseClient } from "@supabase/supabase-js";

import { selectCurrentApprovedPrice } from "@/lib/materials/pricing";
import type { PurchaseUnit } from "@/lib/materials/units";
import {
  decimalText,
  editorDeliveryFromDatabase,
  editorLineFromDatabase,
  type EditorDeliveryAllocation,
  type EditorDraft,
  type EditorLine,
  type PurchaseOrderVatTreatment,
} from "@/lib/purchasing/draft-editor";
import { isPurchaseOrderSupplierId } from "@/lib/purchasing/create-draft";

const VAT_TREATMENTS = new Set<PurchaseOrderVatTreatment>([
  "standard",
  "zero_rated",
  "exempt",
  "reverse_charge",
  "outside_scope",
]);

const PURCHASE_UNITS = new Set<PurchaseUnit>([
  "sheet",
  "roll",
  "linear_metre",
  "square_metre",
  "unit",
  "pack",
]);

export type CatalogueChoice = {
  priceId: string;
  productId: string;
  materialId: string;
  materialName: string;
  description: string;
  supplierSku: string | null;
  unit: string;
  unitPriceExVat: string;
};

export type PurchasingJobOption = {
  id: string;
  reference: string;
  projectName: string;
  status: string;
};

export type PurchaseOrderEditorData = {
  revisionId: string;
  supplierId: string;
  draft: EditorDraft;
  catalogue: CatalogueChoice[];
  jobs: PurchasingJobOption[];
  catalogueError: string | null;
  jobsError: string | null;
};

const LINE_SELECT = [
  "id",
  "line_number",
  "line_kind",
  "material_id",
  "material_supplier_product_id",
  "material_price_id",
  "description",
  "supplier_sku",
  "unit",
  "quantity",
  "unit_price_ex_vat",
  "vat_treatment",
  "purchase_order_allocations(id,target,job_id,quantity)",
].join(",");

export async function loadPurchaseOrderEditor(
  supabase: SupabaseClient,
  orderId: string
): Promise<PurchaseOrderEditorData | null> {
  if (!isPurchaseOrderSupplierId(orderId)) {
    return null;
  }

  const { data, error } = await supabase
    .from("purchase_orders")
    .select(
      [
        "id",
        "supplier_id",
        "status",
        "draft_revision:purchase_order_revisions!purchase_orders_current_draft_revision_fkey(id,supplier_orders_email,vat_treatment,vat_rate,delivery_method,delivery_recipient,delivery_line_1,delivery_line_2,delivery_city,delivery_county,delivery_postcode,delivery_country,delivery_instructions,delivery_date,delivery_charge_ex_vat,delivery_charge_method,purchase_order_lines(" +
          LINE_SELECT +
          "),purchase_order_charge_allocations(id,target,job_id,amount_ex_vat,method))",
      ].join(",")
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    console.error("purchase order editor failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return null;
  }

  if (!isDraftPurchaseOrderRow(data) || data.status !== "draft") {
    return null;
  }

  const revision = one(data.draft_revision);
  if (
    !isDraftRevision(revision) ||
    typeof revision.id !== "string" ||
    typeof data.supplier_id !== "string"
  ) {
    return null;
  }

  const lines = sortLines(revision.purchase_order_lines).flatMap((line) => {
    if (!isPurchaseOrderLineRow(line)) {
      return [];
    }
    const editorLine = editorLineFromDatabase(line);
    return editorLine ? [editorLine] : [];
  });
  const manualDelivery = sortDeliveries(revision.purchase_order_charge_allocations).filter(
    (allocation) => allocation.method === "manual"
  );
  const [catalogueResult, jobsResult] = await Promise.all([
    loadCatalogue(supabase, data.supplier_id, lines),
    loadJobs(supabase),
  ]);

  return {
    revisionId: revision.id,
    supplierId: data.supplier_id,
    draft: {
      supplierOrdersEmail: text(revision.supplier_orders_email),
      vatTreatment: vatTreatment(revision.vat_treatment),
      deliveryMethod: revision.delivery_method === "custom" ? "custom" : "workshop",
      deliveryRecipient: text(revision.delivery_recipient),
      deliveryLine1: text(revision.delivery_line_1),
      deliveryLine2: text(revision.delivery_line_2),
      deliveryCity: text(revision.delivery_city),
      deliveryCounty: text(revision.delivery_county),
      deliveryPostcode: text(revision.delivery_postcode),
      deliveryCountry: text(revision.delivery_country) || "United Kingdom",
      deliveryInstructions: text(revision.delivery_instructions),
      deliveryDate: dateText(revision.delivery_date),
      deliveryChargeExVat: decimalText(decimalValue(revision.delivery_charge_ex_vat)) || "0",
      deliveryChargeMethod:
        revision.delivery_charge_method === "manual" ? "manual" : "proportional",
      lines,
      deliveryAllocations: manualDelivery.flatMap((allocation) => {
        const editorAllocation = editorDeliveryFromDatabase(allocation);
        return editorAllocation ? [editorAllocation] : [];
      }),
      vatRate: numeric(revision.vat_rate) ?? 0.2,
    },
    catalogue: catalogueResult.catalogue,
    jobs: jobsResult.jobs,
    catalogueError: catalogueResult.error,
    jobsError: jobsResult.error,
  };
}

export async function loadSavedDraftLines(
  supabase: SupabaseClient,
  revisionId: string,
  chargeMethod: "proportional" | "manual"
) {
  const [{ data: lines, error: lineError }, { data: charges, error: chargeError }, { data: revision }] =
    await Promise.all([
      supabase
        .from("purchase_order_lines")
        .select(LINE_SELECT)
        .eq("revision_id", revisionId)
        .order("line_number", { ascending: true }),
      supabase
        .from("purchase_order_charge_allocations")
        .select("id,target,job_id,amount_ex_vat,method")
        .eq("revision_id", revisionId),
      supabase
        .from("purchase_order_revisions")
        .select("supplier_orders_email")
        .eq("id", revisionId)
        .maybeSingle(),
    ]);

  if (lineError || chargeError) {
    return null;
  }

  return {
    supplierOrdersEmail: text(revision?.supplier_orders_email),
    lines: (lines ?? []).flatMap((line) => {
      if (!isPurchaseOrderLineRow(line)) {
        return [];
      }
      const editorLine = editorLineFromDatabase(line);
      return editorLine ? [editorLine] : [];
    }),
    deliveryAllocations:
      chargeMethod === "manual"
        ? (charges ?? []).flatMap((charge) => {
            if (charge.method !== "manual") {
              return [];
            }
            const allocation = editorDeliveryFromDatabase(charge);
            return allocation ? [allocation] : [];
          })
        : [],
  };
}

async function loadCatalogue(
  supabase: SupabaseClient,
  supplierId: string,
  lines: EditorLine[]
) {
  const { data, error } = await supabase
    .from("material_supplier_products")
    .select(
      "id, material_id, supplier_sku, supplier_description, materials(name, purchase_unit)"
    )
    .eq("supplier_id", supplierId)
    .eq("active", true)
    .order("supplier_description", { ascending: true });

  if (error) {
    return {
      catalogue: savedCatalogueChoices(lines),
      error: "The supplier catalogue could not be loaded.",
    };
  }

  const products = (data ?? []).flatMap((row) => {
    const material = one(row.materials);
    if (!material?.name || !material.purchase_unit) {
      return [];
    }
    return [
      {
        id: String(row.id),
        materialId: String(row.material_id),
        supplierSku: text(row.supplier_sku) || null,
        description: String(row.supplier_description),
        materialName: String(material.name),
        unit: String(material.purchase_unit),
      },
    ];
  });
  const pricesByProduct = new Map<
    string,
    { id: string; price: number; priceUnit: PurchaseUnit; effectiveDate: string; approvedAt: string; createdAt: string }[]
  >();

  if (products.length > 0) {
    const prices = await supabase
      .from("material_prices")
      .select(
        "id, material_supplier_product_id, price, price_unit, effective_date, approved_at, created_at"
      )
      .in(
        "material_supplier_product_id",
        products.map((product) => product.id)
      );

    if (prices.error) {
      return {
        catalogue: savedCatalogueChoices(lines),
        error: "The supplier catalogue could not be loaded.",
      };
    }

    for (const row of prices.data ?? []) {
      const priceUnit = purchaseUnit(row.price_unit);
      const amount = numeric(row.price);
      if (!priceUnit || amount === null || amount <= 0 || row.approved_at == null) {
        continue;
      }
      const productId = String(row.material_supplier_product_id);
      const current = pricesByProduct.get(productId) ?? [];
      current.push({
        id: String(row.id),
        price: amount,
        priceUnit,
        effectiveDate: String(row.effective_date).slice(0, 10),
        approvedAt: String(row.approved_at),
        createdAt: String(row.created_at),
      });
      pricesByProduct.set(productId, current);
    }
  }

  const catalogue = products.flatMap((product) => {
    const current = selectCurrentApprovedPrice(pricesByProduct.get(product.id) ?? []);
    if (!current) {
      return [];
    }
    return [
      {
        priceId: current.id,
        productId: product.id,
        materialId: product.materialId,
        materialName: product.materialName,
        description: product.description,
        supplierSku: product.supplierSku,
        unit: product.unit,
        unitPriceExVat: decimalText(current.price),
      },
    ];
  });
  const known = new Set(catalogue.map((choice) => choice.priceId));

  return {
    catalogue: [...catalogue, ...savedCatalogueChoices(lines).filter((choice) => !known.has(choice.priceId))],
    error: null,
  };
}

async function loadJobs(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, job_reference, project_name, status")
    .neq("status", "cancelled")
    .order("job_reference", { ascending: true })
    .limit(300);

  if (error) {
    return { jobs: [], error: "Jobs could not be loaded." };
  }

  return {
    jobs: (data ?? []).flatMap((job) => {
      if (!job.id || !job.job_reference) {
        return [];
      }
      return [
        {
          id: String(job.id),
          reference: String(job.job_reference),
          projectName: text(job.project_name),
          status: text(job.status),
        },
      ];
    }),
    error: null,
  };
}

function savedCatalogueChoices(lines: EditorLine[]): CatalogueChoice[] {
  return lines.flatMap((line) => {
    if (line.lineKind !== "catalogue" || !line.priceId || !line.productId || !line.materialId) {
      return [];
    }
    return [
      {
        priceId: line.priceId,
        productId: line.productId,
        materialId: line.materialId,
        materialName: line.description || "Saved catalogue item",
        description: line.description,
        supplierSku: line.supplierSku || null,
        unit: line.unit,
        unitPriceExVat: line.unitPriceExVat,
      },
    ];
  });
}

type DraftPurchaseOrderRow = {
  status?: unknown;
  supplier_id?: unknown;
  draft_revision?: unknown;
};

type DraftRevisionRow = {
  id?: unknown;
  supplier_orders_email?: unknown;
  vat_treatment?: unknown;
  vat_rate?: unknown;
  delivery_method?: unknown;
  delivery_recipient?: unknown;
  delivery_line_1?: unknown;
  delivery_line_2?: unknown;
  delivery_city?: unknown;
  delivery_county?: unknown;
  delivery_postcode?: unknown;
  delivery_country?: unknown;
  delivery_instructions?: unknown;
  delivery_date?: unknown;
  delivery_charge_ex_vat?: unknown;
  delivery_charge_method?: unknown;
  purchase_order_lines?: unknown;
  purchase_order_charge_allocations?: unknown;
};

type PurchaseOrderLineRow = {
  id?: unknown;
  line_number?: unknown;
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
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDraftPurchaseOrderRow(value: unknown): value is DraftPurchaseOrderRow {
  return isPlainRecord(value);
}

function isDraftRevision(value: unknown): value is DraftRevisionRow {
  return isPlainRecord(value);
}

function isPurchaseOrderLineRow(value: unknown): value is PurchaseOrderLineRow {
  return isPlainRecord(value);
}

function decimalValue(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function sortLines<T extends { line_number?: unknown }>(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  return [...rows].sort(
    (left, right) => numberOrZero(left.line_number) - numberOrZero(right.line_number)
  );
}

function sortDeliveries(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  return rows as Array<{
    id?: unknown;
    target?: unknown;
    job_id?: unknown;
    amount_ex_vat?: unknown;
    method?: unknown;
  }>;
}

function one<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function dateText(value: unknown) {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberOrZero(value: unknown) {
  return numeric(value) ?? 0;
}

function vatTreatment(value: unknown): PurchaseOrderVatTreatment {
  return typeof value === "string" && VAT_TREATMENTS.has(value as PurchaseOrderVatTreatment)
    ? (value as PurchaseOrderVatTreatment)
    : "standard";
}

function purchaseUnit(value: unknown): PurchaseUnit | null {
  return typeof value === "string" && PURCHASE_UNITS.has(value as PurchaseUnit)
    ? (value as PurchaseUnit)
    : null;
}
