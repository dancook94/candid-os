import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeSupplierDescription } from "@/lib/materials/identity";
import { isMaterialsSchemaMissing } from "@/lib/materials/write-error";
import { formatPriceDecision } from "@/lib/materials/invoices/price-change";
import { normalizePurchaseUnit } from "@/lib/materials/invoices/match";
import { compareApprovedPrice } from "@/lib/materials/invoices/money";
import { selectCurrentApprovedPrice } from "@/lib/materials/pricing";
import { coercePurchaseUnit } from "@/lib/materials/present";
import type { PurchaseUnit } from "@/lib/materials/units";

import type {
  DescriptionMappingRef,
  IgnoreRuleRef,
  InvoiceAliasRef,
  InvoiceExtractionStatus,
  InvoiceMatchProduct,
  InvoiceProcessingStatus,
  InvoiceReviewStatus,
  InvoiceSupplierRef,
  MatchConfidence,
  MatchMethod,
} from "@/lib/materials/invoices/model";
import type { ExistingInvoiceRef } from "@/lib/materials/invoices/duplicate";

function numeric(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function schemaError(error: { code?: string; message?: string } | null) {
  if (!isMaterialsSchemaMissing(error)) {
    return null;
  }

  return "Supplier invoices are not in this database yet. Apply the supplier invoice migration in Supabase, then reload.";
}

export async function loadInvoiceMatchCatalog(supabase: SupabaseClient) {
  const [suppliers, aliases, materials, products, prices, mappings, ignoreRules, files, invoices] =
    await Promise.all([
      supabase.from("suppliers").select("id, name, normalized_name"),
      supabase.from("supplier_aliases").select("supplier_id, alias, normalized_alias"),
      supabase
        .from("materials")
        .select(
          "id, name, thickness_mm, colour, purchase_unit, purchase_width_mm, purchase_height_mm, purchase_length_mm"
        ),
      supabase
        .from("material_supplier_products")
        .select(
          "id, material_id, supplier_id, supplier_sku, supplier_description, active"
        ),
      supabase
        .from("material_prices")
        .select(
          "id, material_supplier_product_id, price, price_unit, effective_date, approved_at, created_at"
        ),
      supabase
        .from("supplier_product_description_mappings")
        .select("supplier_id, normalized_description, material_supplier_product_id"),
      supabase
        .from("supplier_invoice_ignore_rules")
        .select("supplier_id, normalized_description"),
      supabase.from("supplier_invoice_files").select("invoice_id, checksum_sha256"),
      supabase
        .from("supplier_invoices")
        .select("id, supplier_id, invoice_number, invoice_date"),
    ]);

  const error =
    suppliers.error ??
    aliases.error ??
    materials.error ??
    products.error ??
    prices.error ??
    mappings.error ??
    ignoreRules.error ??
    files.error ??
    invoices.error;

  if (error) {
    return {
      ok: false as const,
      error: schemaError(error) ?? "Supplier invoices could not be loaded.",
    };
  }

  const materialById = new Map((materials.data ?? []).map((row) => [row.id, row]));
  const pricesByProduct = new Map<string, Array<{
    id: string;
    price: number;
    priceUnit: PurchaseUnit;
    effectiveDate: string;
    approvedAt: string;
    createdAt: string;
  }>>();

  for (const row of prices.data ?? []) {
    const price = numeric(row.price);
    const priceUnit = coercePurchaseUnit(row.price_unit);

    if (price == null || !priceUnit) {
      continue;
    }

    const list = pricesByProduct.get(row.material_supplier_product_id) ?? [];
    list.push({
      id: row.id,
      price,
      priceUnit,
      effectiveDate: String(row.effective_date).slice(0, 10),
      approvedAt: row.approved_at,
      createdAt: row.created_at,
    });
    pricesByProduct.set(row.material_supplier_product_id, list);
  }

  const matchProducts: InvoiceMatchProduct[] = [];

  for (const product of products.data ?? []) {
    if (!product.active) {
      continue;
    }

    const material = materialById.get(product.material_id);
    const purchaseUnit = material ? coercePurchaseUnit(material.purchase_unit) : null;

    if (!material || !purchaseUnit) {
      continue;
    }

    const current = selectCurrentApprovedPrice(pricesByProduct.get(product.id) ?? []);

    matchProducts.push({
      id: product.id,
      supplierId: product.supplier_id,
      sku: product.supplier_sku,
      description: product.supplier_description,
      materialName: material.name,
      purchaseUnit,
      thicknessMm: numeric(material.thickness_mm),
      colour: material.colour,
      widthMm: numeric(material.purchase_width_mm),
      heightMm: numeric(material.purchase_height_mm),
      lengthMm: numeric(material.purchase_length_mm),
      currentPrice: current?.price ?? null,
      currentPriceUnit: current?.priceUnit ?? null,
      currentPriceId: current?.id ?? null,
      currentEffectiveDate: current?.effectiveDate ?? null,
    });
  }

  const checksumByInvoice = new Map(
    (files.data ?? []).map((file) => [file.invoice_id, file.checksum_sha256])
  );

  return {
    ok: true as const,
    suppliers: (suppliers.data ?? []).map(
      (row): InvoiceSupplierRef => ({
        id: row.id,
        name: row.name,
        normalizedName: row.normalized_name,
      })
    ),
    aliases: (aliases.data ?? []).map(
      (row): InvoiceAliasRef => ({
        supplierId: row.supplier_id,
        alias: row.alias,
        normalizedAlias: row.normalized_alias,
      })
    ),
    products: matchProducts,
    mappings: (mappings.data ?? []).map(
      (row): DescriptionMappingRef => ({
        supplierId: row.supplier_id,
        normalizedDescription: row.normalized_description,
        productId: row.material_supplier_product_id,
      })
    ),
    ignoreRules: (ignoreRules.data ?? []).map(
      (row): IgnoreRuleRef => ({
        supplierId: row.supplier_id,
        normalizedDescription: row.normalized_description,
      })
    ),
    existingInvoices: (invoices.data ?? []).map(
      (row): ExistingInvoiceRef => ({
        id: row.id,
        supplierId: row.supplier_id,
        invoiceNumber: row.invoice_number,
        invoiceDate: row.invoice_date,
        checksumSha256: checksumByInvoice.get(row.id) ?? "",
      })
    ),
  };
}

export type InvoiceListItem = {
  id: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  total: number | null;
  extractionStatus: InvoiceExtractionStatus;
  processingStatus: InvoiceProcessingStatus;
  createdAt: string;
  lineCounts: Record<InvoiceReviewStatus, number>;
};

export async function loadInvoiceList(supabase: SupabaseClient) {
  const [invoices, lines, suppliers] = await Promise.all([
    supabase
      .from("supplier_invoices")
      .select(
        "id, supplier_id, invoice_number, invoice_date, total, extraction_status, processing_status, created_at"
      )
      .order("created_at", { ascending: false }),
    supabase.from("supplier_invoice_lines").select("invoice_id, review_status"),
    supabase.from("suppliers").select("id, name"),
  ]);
  const error = invoices.error ?? lines.error ?? suppliers.error;

  if (error) {
    return {
      ok: false as const,
      error: schemaError(error) ?? "Supplier invoices could not be loaded.",
    };
  }

  const supplierName = new Map((suppliers.data ?? []).map((row) => [row.id, row.name]));
  const counts = new Map<string, Record<InvoiceReviewStatus, number>>();

  for (const line of lines.data ?? []) {
    const current = counts.get(line.invoice_id) ?? emptyLineCounts();
    const status = line.review_status as InvoiceReviewStatus;

    if (status in current) {
      current[status] += 1;
    }

    counts.set(line.invoice_id, current);
  }

  return {
    ok: true as const,
    invoices: (invoices.data ?? []).map(
      (row): InvoiceListItem => ({
        id: row.id,
        supplierName: row.supplier_id ? supplierName.get(row.supplier_id) ?? null : null,
        invoiceNumber: row.invoice_number,
        invoiceDate: row.invoice_date,
        total: numeric(row.total),
        extractionStatus: row.extraction_status as InvoiceExtractionStatus,
        processingStatus: row.processing_status as InvoiceProcessingStatus,
        createdAt: row.created_at,
        lineCounts: counts.get(row.id) ?? emptyLineCounts(),
      })
    ),
  };
}

export function emptyLineCounts(): Record<InvoiceReviewStatus, number> {
  return {
    processed: 0,
    price_change: 0,
    needs_review: 0,
    unmatched: 0,
    ignored: 0,
    query: 0,
    extraction_error: 0,
  };
}

export type InvoiceDetailLine = {
  id: string;
  lineNumber: number;
  rawDescription: string;
  rawSupplierSku: string | null;
  rawQuantity: number | null;
  rawUnit: string | null;
  rawUnitPrice: number | null;
  rawLineTotal: number | null;
  reviewedDescription: string | null;
  reviewedSupplierSku: string | null;
  reviewedQuantity: number | null;
  reviewedUnit: string | null;
  reviewedUnitPrice: number | null;
  reviewedLineTotal: number | null;
  matchedProductId: string | null;
  matchedProductLabel: string | null;
  matchConfidence: MatchConfidence | null;
  matchMethod: MatchMethod | null;
  reviewStatus: InvoiceReviewStatus;
  mathsWarning: string | null;
  internalNote: string | null;
  materialName: string | null;
  productDescription: string | null;
  decisionSummary: string | null;
  comparison: {
    currentPrice: number;
    currentPriceId: string | null;
    currentEffectiveDate: string | null;
    invoicePrice: number;
    difference: number;
    percent: number;
    priceUnit: PurchaseUnit;
  } | null;
};

export async function loadInvoiceDetail(supabase: SupabaseClient, invoiceId: string) {
  const catalog = await loadInvoiceMatchCatalog(supabase);

  if (!catalog.ok) {
    return catalog;
  }

  const [invoice, lines, file, events] = await Promise.all([
    supabase.from("supplier_invoices").select("*").eq("id", invoiceId).maybeSingle(),
    supabase
      .from("supplier_invoice_lines")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("line_number"),
    supabase
      .from("supplier_invoice_files")
      .select("*")
      .eq("invoice_id", invoiceId)
      .maybeSingle(),
    supabase
      .from("supplier_invoice_events")
      .select("id, action, metadata, created_at, invoice_line_id")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: false }),
  ]);
  const error = invoice.error ?? lines.error ?? file.error ?? events.error;

  if (error) {
    return {
      ok: false as const,
      error: schemaError(error) ?? "This invoice could not be loaded.",
    };
  }

  if (!invoice.data) {
    return { ok: false as const, error: "Invoice not found.", missing: true };
  }

  const productById = new Map(catalog.products.map((product) => [product.id, product]));
  const detailLines: InvoiceDetailLine[] = (lines.data ?? []).map((row) => {
    const product = row.matched_supplier_product_id
      ? productById.get(row.matched_supplier_product_id) ?? null
      : null;
    const invoicePrice = numeric(row.reviewed_unit_price) ?? numeric(row.raw_unit_price);
    const purchaseUnit = normalizePurchaseUnit(row.reviewed_unit ?? row.raw_unit);
    const comparison =
      product &&
      product.currentPrice != null &&
      product.currentPriceUnit &&
      product.currentPriceId &&
      product.currentEffectiveDate &&
      invoicePrice != null &&
      purchaseUnit === product.purchaseUnit &&
      purchaseUnit === product.currentPriceUnit
        ? compareApprovedPrice(product.currentPrice, invoicePrice, product.currentPriceUnit, {
            currentPriceId: product.currentPriceId,
            currentEffectiveDate: product.currentEffectiveDate,
          })
        : null;
    const decision = (events.data ?? []).find(
      (event) =>
        event.invoice_line_id === row.id &&
        (event.action === "price_change_approved" ||
          event.action === "price_change_rejected" ||
          event.action === "price_change_queried")
    );

    return {
      id: row.id,
      lineNumber: row.line_number,
      rawDescription: row.raw_description,
      rawSupplierSku: row.raw_supplier_sku,
      rawQuantity: numeric(row.raw_quantity),
      rawUnit: row.raw_unit,
      rawUnitPrice: numeric(row.raw_unit_price),
      rawLineTotal: numeric(row.raw_line_total),
      reviewedDescription: row.reviewed_description,
      reviewedSupplierSku: row.reviewed_supplier_sku,
      reviewedQuantity: numeric(row.reviewed_quantity),
      reviewedUnit: row.reviewed_unit,
      reviewedUnitPrice: numeric(row.reviewed_unit_price),
      reviewedLineTotal: numeric(row.reviewed_line_total),
      matchedProductId: row.matched_supplier_product_id,
      matchedProductLabel: product
        ? `${product.materialName} — ${product.description}`
        : null,
      materialName: product?.materialName ?? null,
      productDescription: product?.description ?? null,
      decisionSummary: decision ? formatPriceDecision(decision.action, decision.metadata) : null,
      matchConfidence: row.match_confidence as MatchConfidence | null,
      matchMethod: row.match_method as MatchMethod | null,
      reviewStatus: row.review_status as InvoiceReviewStatus,
      mathsWarning: row.maths_warning,
      internalNote: row.internal_note,
      comparison,
    };
  });

  return {
    ok: true as const,
    invoice: invoice.data,
    lines: detailLines,
    file: file.data,
    events: events.data ?? [],
    suppliers: catalog.suppliers,
    products: catalog.products.filter(
      (product) => product.supplierId === invoice.data.supplier_id
    ),
    catalog,
  };
}

export function mappingKey(description: string) {
  return normalizeSupplierDescription(description);
}
