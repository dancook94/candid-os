import { revalidatePath } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import {
  buildBulkReview,
  planBulkDecision,
  type BulkCatalogueMaterial,
  type BulkDecision,
  type BulkReviewSourceInvoice,
  type BulkReviewSourceLine,
} from "@/lib/materials/invoices/bulk-review";
import type { InvoiceMatchProduct, InvoiceReviewStatus } from "@/lib/materials/invoices/model";
import { INVOICE_REVIEW_STATUSES } from "@/lib/materials/invoices/model";
import { selectCurrentApprovedPrice } from "@/lib/materials/pricing";
import { createClient } from "@/lib/supabase/server";
import { isPurchaseUnit, type PurchaseUnit } from "@/lib/materials/units";

async function requireAdmin() {
  const supabase = await createClient();
  const auth = await verifyApprovedAdmin(supabase);

  if (!auth.ok) {
    return { ok: false as const, status: auth.status, error: auth.message };
  }

  return { ok: true as const, supabase, userId: auth.userId };
}

export async function loadBulkReview(supabase: SupabaseClient) {
  const loaded = await loadReviewTables(supabase);

  if (!loaded.ok) {
    return loaded;
  }

  const flags = await loadDecisionFlags(
    supabase,
    loaded.lines.map((line) => line.id)
  );

  if (!flags.ok) {
    return flags;
  }

  return {
    ok: true as const,
    ...buildBulkReview({
      ...loaded,
      lines: loaded.lines.map((line) => withFlags(line, flags.flags.get(line.id))),
    }),
  };
}

export async function applyBulkReviewDecision(body: unknown) {
  const access = await requireAdmin();

  if (!access.ok) {
    return access;
  }

  const decision = parseDecision(body);

  if (!decision) {
    return { ok: false as const, status: 400, error: "The review decision was not understood." };
  }

  const loaded = await loadReviewTables(access.supabase);

  if (!loaded.ok) {
    return loaded;
  }

  const flags = await loadDecisionFlags(access.supabase, decision.lineIds);

  if (!flags.ok) {
    return flags;
  }

  const selected = decision.lineIds.map((id) => {
    const line = loaded.lines.find((item) => item.id === id);

    if (!line) {
      return null;
    }

    const flag = flags.flags.get(id);
    return withFlags(line, flag);
  });

  if (selected.some((line) => line == null)) {
    return {
      ok: false as const,
      status: 409,
      error: "A selected line no longer exists. Reload before applying.",
    };
  }

  const built = buildBulkReview(loaded);
  const plan = planBulkDecision(
    built.groups,
    selected.filter((line): line is BulkReviewSourceLine => line != null),
    loaded.materials,
    decision
  );

  if (!plan.ok) {
    return plan;
  }

  if (plan.alreadyComplete || plan.write == null) {
    return { ok: true as const, alreadyComplete: true as const };
  }

  const applied = await applyPlan(access.supabase, access.userId, plan.write, plan.lineIds);

  if (!applied.ok) {
    return applied;
  }

  revalidatePath("/admin/materials/invoices/bulk-review");
  revalidatePath("/admin/materials/invoices");
  revalidatePath("/admin/materials/invoices/exceptions");
  revalidatePath("/admin/materials");

  return { ok: true as const, alreadyComplete: applied.alreadyComplete };
}

async function applyPlan(
  supabase: SupabaseClient,
  actorId: string,
  write: Exclude<Extract<Awaited<ReturnType<typeof planBulkDecision>>, { ok: true }>["write"], null>,
  lineIds: string[]
) {
  if (write.type === "ignore_charges") {
    return callRpc(supabase, "ignore_bulk_invoice_charges", {
      p_line_ids: lineIds,
      p_actor_id: actorId,
    });
  }

  if (write.type === "confirm_product") {
    return callRpc(supabase, "confirm_bulk_invoice_products", {
      p_line_ids: lineIds,
      p_product_id: write.productId,
      p_actor_id: actorId,
    });
  }

  if (write.type === "keep_historical_price") {
    return callRpc(supabase, "retain_bulk_historical_invoice_prices", {
      p_line_ids: lineIds,
      p_expected_product_id: write.productId,
      p_expected_price_id: write.currentPriceId,
      p_expected_invoice_price: write.invoicePrice,
      p_actor_id: actorId,
    });
  }

  if (write.type === "approve_current_price") {
    return callRpc(supabase, "approve_bulk_invoice_price", {
      p_line_ids: lineIds,
      p_expected_product_id: write.productId,
      p_expected_price_id: write.currentPriceId,
      p_expected_invoice_price: write.invoicePrice,
      p_actor_id: actorId,
    });
  }

  if (write.type === "set_purchase_unit") {
    return callRpc(supabase, "set_bulk_invoice_purchase_units", {
      p_line_ids: lineIds,
      p_unit: write.unit,
      p_actor_id: actorId,
    });
  }

  if (write.type === "accept_rounding") {
    return callRpc(supabase, "accept_bulk_rounding_discrepancy", {
      p_line_ids: lineIds,
      p_actor_id: actorId,
    });
  }

  return callRpc(supabase, "create_bulk_material_from_invoice_lines", {
    p_line_ids: lineIds,
    p_actor_id: actorId,
    p_name: write.name,
    p_purchase_unit: write.unit,
    p_purchase_width_mm: write.widthMm,
    p_purchase_height_mm: write.heightMm,
    p_purchase_length_mm: write.lengthMm,
    p_supplier_sku: write.sku,
    p_price: write.openingPrice,
  });
}

async function callRpc(supabase: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);

  if (error) {
    const missing = /function .* does not exist|schema cache/i.test(error.message);
    return {
      ok: false as const,
      status: missing ? 503 : 409,
      error: missing
        ? "Apply the bulk review migration on Test before using this action."
        : error.message,
    };
  }

  const alreadyComplete = Boolean(
    data && typeof data === "object" && "alreadyResolved" in data && data.alreadyResolved === true
  );

  return { ok: true as const, alreadyComplete };
}

async function loadReviewTables(supabase: SupabaseClient) {
  const [invoiceRows, lineRows, supplierRows, materialRows, productRows, priceRows] = await Promise.all([
    fetchAll(() =>
      supabase
        .from("supplier_invoices")
        .select("id, invoice_number, invoice_date, supplier_id, extraction_status, extraction_warnings, processing_status, subtotal, vat, total")
        .order("id")
    ),
    fetchAll(() =>
      supabase
        .from("supplier_invoice_lines")
        .select(
          "id, invoice_id, raw_description, raw_supplier_sku, raw_quantity, raw_unit, raw_unit_price, raw_line_total, reviewed_unit, review_status, maths_warning, matched_supplier_product_id, match_confidence"
        )
        .order("id")
    ),
    fetchAll(() => supabase.from("suppliers").select("id, name").order("id")),
    fetchAll(() =>
      supabase
        .from("materials")
        .select(
          "id, name, thickness_mm, colour, finish, purchase_unit, purchase_width_mm, purchase_height_mm, purchase_length_mm"
        )
        .order("id")
    ),
    fetchAll(() =>
      supabase
        .from("material_supplier_products")
        .select("id, material_id, supplier_id, supplier_sku, supplier_description, active")
        .eq("active", true)
        .order("id")
    ),
    fetchAll(() =>
      supabase
        .from("material_prices")
        .select("id, material_supplier_product_id, price, price_unit, effective_date, approved_at, created_at")
        .order("id")
    ),
  ]);
  const failed = [invoiceRows, lineRows, supplierRows, materialRows, productRows, priceRows].find((result) => !result.ok);

  if (failed && !failed.ok) {
    return { ok: false as const, status: 500, error: failed.error };
  }

  if (!invoiceRows.ok || !lineRows.ok || !supplierRows.ok || !materialRows.ok || !productRows.ok || !priceRows.ok) {
    return { ok: false as const, status: 500, error: "The review queue could not be loaded." };
  }

  const supplierNames = new Map(supplierRows.rows.map((row) => [String(row.id), text(row.name) ?? "Supplier"]));
  const materials = materialRows.rows.flatMap((row) => {
    const purchaseUnit = text(row.purchase_unit);

    if (!purchaseUnit || !isPurchaseUnit(purchaseUnit) || !text(row.name)) {
      return [];
    }

    return [
      {
        id: String(row.id),
        name: text(row.name) ?? "",
        purchaseUnit,
        thicknessMm: number(row.thickness_mm),
        colour: text(row.colour),
        finish: text(row.finish),
        widthMm: number(row.purchase_width_mm),
        heightMm: number(row.purchase_height_mm),
        lengthMm: number(row.purchase_length_mm),
      } satisfies BulkCatalogueMaterial,
    ];
  });
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const pricesByProduct = new Map<string, Array<{
    id: string;
    price: number;
    priceUnit: PurchaseUnit;
    effectiveDate: string;
    approvedAt: string;
    createdAt: string;
  }>>();

  for (const row of priceRows.rows) {
    const price = number(row.price);
    const priceUnit = text(row.price_unit);

    if (price == null || !priceUnit || !isPurchaseUnit(priceUnit)) {
      continue;
    }

    const list = pricesByProduct.get(String(row.material_supplier_product_id)) ?? [];
    list.push({
      id: String(row.id),
      price,
      priceUnit,
      effectiveDate: String(row.effective_date).slice(0, 10),
      approvedAt: String(row.approved_at ?? ""),
      createdAt: String(row.created_at ?? ""),
    });
    pricesByProduct.set(String(row.material_supplier_product_id), list);
  }

  const products: InvoiceMatchProduct[] = [];

  for (const row of productRows.rows) {
    const material = materialById.get(String(row.material_id));

    if (!material) {
      continue;
    }

    const current = selectCurrentApprovedPrice(pricesByProduct.get(String(row.id)) ?? []);
    products.push({
      id: String(row.id),
      supplierId: String(row.supplier_id),
      sku: text(row.supplier_sku),
      description: text(row.supplier_description) ?? "",
      materialName: material.name,
      purchaseUnit: material.purchaseUnit,
      thicknessMm: material.thicknessMm,
      colour: material.colour,
      widthMm: material.widthMm,
      heightMm: material.heightMm,
      lengthMm: material.lengthMm,
      currentPrice: current?.price ?? null,
      currentPriceUnit: current?.priceUnit ?? null,
      currentPriceId: current?.id ?? null,
      currentEffectiveDate: current?.effectiveDate ?? null,
    });
  }

  const invoices: BulkReviewSourceInvoice[] = invoiceRows.rows.map((row) => ({
    id: String(row.id),
    number: text(row.invoice_number),
    date: text(row.invoice_date)?.slice(0, 10) ?? null,
    supplierId: text(row.supplier_id),
    supplierName: row.supplier_id ? supplierNames.get(String(row.supplier_id)) ?? "Supplier" : null,
    extractionStatus: text(row.extraction_status) ?? "failed",
    extractionWarnings: warnings(row.extraction_warnings),
    processingStatus: text(row.processing_status) ?? "extraction_error",
    subtotal: number(row.subtotal),
    vat: number(row.vat),
    total: number(row.total),
  }));
  const lines: BulkReviewSourceLine[] = lineRows.rows.flatMap((row) => {
    const reviewStatus = text(row.review_status);

    if (!reviewStatus || !isReviewStatus(reviewStatus)) {
      return [];
    }

    const confidence = text(row.match_confidence);

    return [
      {
        id: String(row.id),
        invoiceId: String(row.invoice_id),
        description: text(row.raw_description) ?? "",
        sku: text(row.raw_supplier_sku),
        quantity: number(row.raw_quantity),
        statedUnit: text(row.raw_unit),
        reviewedUnit: text(row.reviewed_unit),
        unitPrice: number(row.raw_unit_price),
        lineTotal: number(row.raw_line_total),
        reviewStatus,
        mathsWarning: text(row.maths_warning),
        matchedProductId: text(row.matched_supplier_product_id),
        matchConfidence: confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : null,
        historicalPriceRetained: false,
        bulkPriceApproved: false,
        roundingAccepted: false,
      },
    ];
  });

  return { ok: true as const, invoices, lines, products, materials };
}

type DecisionFlags = {
  historicalPriceRetained: boolean;
  bulkPriceApproved: boolean;
  roundingAccepted: boolean;
};

function withFlags(line: BulkReviewSourceLine, flag: DecisionFlags | undefined): BulkReviewSourceLine {
  return {
    ...line,
    historicalPriceRetained: flag?.historicalPriceRetained ?? false,
    bulkPriceApproved: flag?.bulkPriceApproved ?? false,
    roundingAccepted: flag?.roundingAccepted ?? false,
  };
}

async function loadDecisionFlags(supabase: SupabaseClient, lineIds: string[]) {
  const flags = new Map<string, DecisionFlags>();

  if (lineIds.length === 0) {
    return { ok: true as const, flags };
  }

  for (let index = 0; index < lineIds.length; index += 200) {
    const chunk = lineIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("supplier_invoice_events")
      .select("invoice_line_id, action, metadata")
      .in("invoice_line_id", chunk)
      .in("action", ["price_change_rejected", "price_change_approved", "line_corrected"]);

    if (error) {
      return { ok: false as const, status: 500, error: "The earlier review decisions could not be checked." };
    }

    for (const row of data ?? []) {
      const id = String(row.invoice_line_id);
      const current = flags.get(id) ?? {
        historicalPriceRetained: false,
        bulkPriceApproved: false,
        roundingAccepted: false,
      };
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};

      if (row.action === "price_change_rejected" && metadata.rule === "historical_price") {
        current.historicalPriceRetained = true;
      }

      if (row.action === "price_change_approved" && metadata.bulk === true) {
        current.bulkPriceApproved = true;
      }

      if (row.action === "line_corrected" && metadata.rule === "rounding_discrepancy") {
        current.roundingAccepted = true;
      }

      flags.set(id, current);
    }
  }

  return { ok: true as const, flags };
}

function parseDecision(body: unknown): BulkDecision | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  const lineIds = Array.isArray(record.lineIds)
    ? record.lineIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const confirmed = record.confirmed === true;
  const action = record.action;

  if (action === "ignore_charges") {
    return { action, confirmed, lineIds };
  }

  if (action === "confirm_product" && typeof record.productId === "string") {
    return { action, confirmed, lineIds, productId: record.productId };
  }

  if (action === "keep_historical_price") {
    return { action, confirmed, lineIds };
  }

  if (action === "approve_current_price") {
    return { action, confirmed, lineIds, approveCurrent: record.approveCurrent === true };
  }

  if (action === "set_purchase_unit" && typeof record.unit === "string") {
    return { action, confirmed, lineIds, unit: record.unit };
  }

  if (action === "accept_rounding") {
    return { action, confirmed, lineIds, acceptRounding: record.acceptRounding === true };
  }

  if (
    action === "create_material" &&
    typeof record.name === "string" &&
    typeof record.openingPrice === "number"
  ) {
    return {
      action,
      confirmed,
      lineIds,
      name: record.name,
      openingPrice: record.openingPrice,
      acknowledgedSimilar: record.acknowledgedSimilar === true,
    };
  }

  return null;
}

async function fetchAll(build: () => {
  range: (
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}) {
  const rows: Array<Record<string, unknown>> = [];

  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);

    if (error) {
      return { ok: false as const, error: error.message };
    }

    rows.push(...((data ?? []) as Array<Record<string, unknown>>));

    if (!data || data.length < 1000) {
      return { ok: true as const, rows };
    }
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function number(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return null;
}

function warnings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isReviewStatus(value: string): value is InvoiceReviewStatus {
  return (INVOICE_REVIEW_STATUSES as readonly string[]).includes(value);
}
