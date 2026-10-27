import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { GMAIL_IMPORT_FILES_BUCKET } from "@/lib/gmail/config";
import { promotionQueue, storedDocumentRelevance, classifyDocumentRelevance } from "@/lib/gmail/relevance";
import { findDuplicateInvoice, type ExistingInvoiceRef } from "@/lib/materials/invoices/duplicate";
import { buildInvoiceDraft } from "@/lib/materials/invoices/draft";
import { extractInvoiceDocument } from "@/lib/materials/invoices/extract";
import { historicalPriceDecision } from "@/lib/materials/invoices/historical-price";
import {
  SUPPLIER_INVOICE_FILES_BUCKET,
  type DescriptionMappingRef,
  type IgnoreRuleRef,
  type InvoiceAliasRef,
  type InvoiceExtractionStatus,
  type InvoiceMatchProduct,
  type InvoiceSupplierRef,
} from "@/lib/materials/invoices/model";
import { recordPriceChangeDetections } from "@/lib/materials/invoices/price-change-events";
import { isMaterialsSchemaMissing, postgresColumnMissing } from "@/lib/materials/write-error";
import type { PurchaseUnit } from "@/lib/materials/units";
import {
  GMAIL_PROMOTION_BATCH_LIMIT,
  PYRAMID_SUPPLIER_NAME,
  type PromotionBlock,
  type PromotionOutcome,
  type PromotionPreviewRow,
  type PromotionReport,
} from "@/lib/materials/invoices/gmail-promotion-view";

export {
  GMAIL_PROMOTION_BATCH_LIMIT,
  PYRAMID_SUPPLIER_NAME,
  selectPyramidPilot,
  type PromotionBlock,
  type PromotionOutcome,
  type PromotionPreviewRow,
  type PromotionReport,
} from "@/lib/materials/invoices/gmail-promotion-view";

export const GMAIL_IMPORT_SOURCE = "gmail_import";

const PROMOTABLE_DOCUMENT = "invoice";
const PROMOTABLE_STATUS = "stored";
const MIGRATION_MESSAGE =
  "Apply the Gmail invoice promotion migration before promoting stored invoices.";

export type PromotionExistingInvoice = ExistingInvoiceRef & {
  gmailImportItemId: string | null;
};

export type PromotionCandidate = {
  itemId: string;
  documentType: string;
  status: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierApproved?: boolean;
  relevance?: "supplier_invoice" | "needs_review" | "irrelevant" | null;
  detail?: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  filename: string;
  gmailMessageId: string;
  gmailAttachmentId: string;
  storagePath: string | null;
  checksumSha256: string | null;
  mimeType: string | null;
  byteSize: number | null;
};

export type PromotionPriceRef = {
  productId: string;
  id: string;
  price: number;
  priceUnit: PurchaseUnit;
  effectiveDate: string;
  approvedAt: string;
  createdAt: string;
};

export type PromotionCatalog = {
  suppliers: readonly InvoiceSupplierRef[];
  aliases: readonly InvoiceAliasRef[];
  products: readonly InvoiceMatchProduct[];
  mappings: readonly DescriptionMappingRef[];
  ignoreRules: readonly IgnoreRuleRef[];
  prices?: readonly PromotionPriceRef[];
};

export type HistoricalPriceRetentionRequest = {
  lineId: string;
  productId: string;
  priceId: string;
  invoicePrice: number;
  actorId: string;
};

type WriteError = { code?: string; message?: string } | null;

export type PromotionDatabase = {
  insertInvoice(row: Record<string, unknown>): Promise<{ id: string } | { error: WriteError }>;
  deleteInvoice(invoiceId: string): Promise<void>;
  insertFile(row: Record<string, unknown>): Promise<WriteError>;
  insertLines(rows: Record<string, unknown>[]): Promise<WriteError>;
  insertEvents(rows: Record<string, unknown>[]): Promise<void>;
  markDocument(
    itemId: string,
    update: { status: "stored" | "skipped"; detail: string; relevance: "needs_review" | "irrelevant" }
  ): Promise<void>;
  listLines(
    invoiceId: string
  ): Promise<Array<{ id: string; line_number: number; review_status: string; matched_supplier_product_id: string | null }>>;
  retainHistoricalPrice?(
    input: HistoricalPriceRetentionRequest
  ): Promise<{ ok: true; alreadyResolved: boolean } | { ok: false; error: string }>;
};

export type PromotionFiles = {
  download(path: string): Promise<Uint8Array>;
  upload(path: string, bytes: Uint8Array, mimeType: string): Promise<WriteError>;
  remove(path: string): Promise<void>;
};

type ExtractedDocument = {
  text: string | null;
  extractionStatus: "extracted" | "failed" | "needs_ocr";
  warnings: string[];
};

export async function requireGmailPromotionAccess(supabase: SupabaseClient) {
  const auth = await verifyApprovedAdmin(supabase);

  if (!auth.ok) {
    return { ok: false as const, status: auth.status, error: auth.message };
  }

  return { ok: true as const, userId: auth.userId };
}

export function assertPromotionBatch(itemIds: readonly string[]) {
  const unique = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];

  if (unique.length === 0) {
    throw new Error("Choose at least one stored invoice.");
  }

  if (unique.length > GMAIL_PROMOTION_BATCH_LIMIT) {
    throw new Error(`Promote at most ${GMAIL_PROMOTION_BATCH_LIMIT} invoices at a time.`);
  }

  return unique;
}

export function assessStoredInvoice(input: {
  itemId: string;
  checksumSha256: string | null;
  supplierId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  existing: readonly PromotionExistingInvoice[];
}): PromotionBlock | null {
  const promoted = input.existing.find((invoice) => invoice.gmailImportItemId === input.itemId);

  if (promoted) {
    return {
      kind: "already_promoted",
      invoiceId: promoted.id,
      detail: "This Gmail invoice is already in review.",
    };
  }

  if (!input.checksumSha256) {
    return null;
  }

  const duplicate = findDuplicateInvoice({
    checksumSha256: input.checksumSha256,
    supplierId: input.supplierId,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    existing: input.existing,
  });

  if (!duplicate) {
    return null;
  }

  const checksumMatch = input.existing.some(
    (invoice) => invoice.checksumSha256 === input.checksumSha256
  );

  return {
    kind: checksumMatch ? "checksum" : "invoice_number",
    invoiceId: duplicate.invoiceId,
    detail: duplicate.reason,
  };
}

function previewVisible(candidate: PromotionCandidate) {
  if (!candidate.storagePath || !candidate.checksumSha256 || candidate.mimeType !== "application/pdf") {
    return false;
  }

  if (candidate.relevance === "irrelevant" || candidate.relevance === "needs_review") {
    return true;
  }

  const detail = candidate.detail ?? "";

  if (
    detail.startsWith("Excluded as irrelevant") ||
    detail.startsWith("Needs manual classification") ||
    detail.startsWith("Marked as not a supplier invoice")
  ) {
    return true;
  }

  return candidate.documentType === PROMOTABLE_DOCUMENT && candidate.status === PROMOTABLE_STATUS;
}

export function buildPromotionPreview(input: {
  candidates: readonly PromotionCandidate[];
  existing: readonly PromotionExistingInvoice[];
}): PromotionPreviewRow[] {
  return input.candidates
    .filter(previewVisible)
    .map((candidate) => {
      const duplicate = assessStoredInvoice({
        itemId: candidate.itemId,
        checksumSha256: candidate.checksumSha256,
        supplierId: candidate.supplierId,
        invoiceNumber: candidate.invoiceNumber,
        invoiceDate: candidate.invoiceDate,
        existing: input.existing,
      });
      const assigned = promotionQueue({
        supplierMatched: Boolean(candidate.supplierId),
        supplierApproved: Boolean(candidate.supplierApproved),
        relevance: candidate.relevance ?? storedDocumentRelevance({ detail: candidate.detail }),
        status: candidate.status,
        documentType: candidate.documentType,
      });

      const storedReason = candidate.detail ?? "";
      const specificReason =
        storedReason.startsWith("Excluded as irrelevant") ||
        storedReason.startsWith("Needs manual classification") ||
        storedReason.startsWith("Marked as not a supplier invoice");

      return {
        itemId: candidate.itemId,
        supplierName: candidate.supplierName,
        invoiceNumber: candidate.invoiceNumber,
        invoiceDate: candidate.invoiceDate,
        filename: candidate.filename,
        pyramid: candidate.supplierName === PYRAMID_SUPPLIER_NAME,
        duplicate,
        selectable: assigned.selectable && duplicate == null,
        queue: assigned.queue,
        queueReason: duplicate && assigned.queue !== "excluded" ? duplicate.detail : specificReason ? storedReason : assigned.reason,
      };
    })
    .sort(comparePromotionRows);
}

export async function runPromotionBatch(input: {
  itemIds: readonly string[];
  candidates: readonly PromotionCandidate[];
  catalog: PromotionCatalog;
  existing: PromotionExistingInvoice[];
  userId: string;
  files: PromotionFiles;
  db: PromotionDatabase;
  extract?: (bytes: Uint8Array, mimeType: string) => Promise<ExtractedDocument>;
  mode?: "automatic" | "manual";
}): Promise<PromotionReport> {
  const itemIds = assertPromotionBatch(input.itemIds);
  const results: PromotionOutcome[] = [];

  for (const itemId of itemIds) {
    const candidate = input.candidates.find((item) => item.itemId === itemId);
    const outcome = await promoteOne({
      candidate: candidate ?? null,
      requestedId: itemId,
      catalog: input.catalog,
      existing: input.existing,
      userId: input.userId,
      files: input.files,
      db: input.db,
      extract: input.extract,
      mode: input.mode ?? "automatic",
    });
    results.push(outcome);

    if (outcome.outcome === "promoted" && outcome.invoiceId) {
      input.existing.push({
        id: outcome.invoiceId,
        supplierId: outcome.supplierId ?? candidate?.supplierId ?? null,
        invoiceNumber: outcome.invoiceNumber,
        invoiceDate: outcome.invoiceDate,
        checksumSha256: candidate?.checksumSha256 ?? "",
        gmailImportItemId: itemId,
      });
    }
  }

  return summarise(results);
}

async function promoteOne(input: {
  candidate: PromotionCandidate | null;
  requestedId: string;
  catalog: PromotionCatalog;
  existing: readonly PromotionExistingInvoice[];
  userId: string;
  files: PromotionFiles;
  db: PromotionDatabase;
  extract?: (bytes: Uint8Array, mimeType: string) => Promise<ExtractedDocument>;
  mode: "automatic" | "manual";
}): Promise<PromotionOutcome> {
  const candidate = input.candidate;

  if (!candidate) {
    return skipped(input.requestedId, "This stored invoice could not be found.");
  }

  const base = {
    itemId: candidate.itemId,
    filename: candidate.filename,
    supplierName: candidate.supplierName,
    invoiceNumber: candidate.invoiceNumber,
    invoiceDate: candidate.invoiceDate,
  };

  if (
    candidate.documentType !== PROMOTABLE_DOCUMENT ||
    candidate.status !== PROMOTABLE_STATUS ||
    !candidate.storagePath ||
    !candidate.checksumSha256 ||
    candidate.mimeType !== "application/pdf"
  ) {
    return {
      ...base,
      outcome: "skipped",
      invoiceId: null,
      extractionFailed: false,
      detail: "Only stored invoice PDFs can be promoted.",
    };
  }

  const knownDuplicate = assessStoredInvoice({
    itemId: candidate.itemId,
    checksumSha256: candidate.checksumSha256,
    supplierId: candidate.supplierId,
    invoiceNumber: candidate.invoiceNumber,
    invoiceDate: candidate.invoiceDate,
    existing: input.existing,
  });

  if (knownDuplicate) {
    return {
      ...base,
      outcome: "duplicate",
      invoiceId: knownDuplicate.invoiceId,
      extractionFailed: false,
      detail: knownDuplicate.detail,
    };
  }

  let bytes: Uint8Array;

  try {
    bytes = await input.files.download(candidate.storagePath);
  } catch (error) {
    return failed(base, error instanceof Error ? error.message : "The stored PDF could not be read.");
  }

  const checksum = createHash("sha256").update(bytes).digest("hex");

  if (checksum !== candidate.checksumSha256) {
    return failed(base, "The stored PDF does not match its saved checksum.");
  }

  const extracted = input.extract
    ? await input.extract(bytes, candidate.mimeType)
    : await extractInvoiceDocument({ bytes, mimeType: candidate.mimeType });
  const draft = buildInvoiceDraft({
    text: extracted.text,
    extractionStatus: extracted.extractionStatus,
    extractionWarnings: extracted.warnings,
    suppliers: input.catalog.suppliers,
    aliases: input.catalog.aliases,
    products: input.catalog.products,
    mappings: input.catalog.mappings,
    ignoreRules: input.catalog.ignoreRules,
  });
  const invoiceDate = draft.invoiceDate ?? candidate.invoiceDate;
  const supplierId = draft.supplierId ?? candidate.supplierId;
  const invoiceNumber = draft.invoiceNumber ?? candidate.invoiceNumber;
  const extractedDuplicate = assessStoredInvoice({
    itemId: candidate.itemId,
    checksumSha256: checksum,
    supplierId,
    invoiceNumber,
    invoiceDate,
    existing: input.existing,
  });

  if (extractedDuplicate) {
    return {
      ...base,
      supplierName: draft.supplierName ?? candidate.supplierName,
      invoiceNumber,
      invoiceDate,
      outcome: "duplicate",
      invoiceId: extractedDuplicate.invoiceId,
      extractionFailed: false,
      detail: extractedDuplicate.detail,
    };
  }

  const relevance = classifyDocumentRelevance(extracted.text ?? "");
  const hold = promotionHold({
    mode: input.mode,
    relevance,
    supplierMatched: Boolean(candidate.supplierId),
    supplierApproved: Boolean(candidate.supplierApproved),
  });

  if (hold) {
    try {
      await input.db.markDocument(candidate.itemId, hold.mark);
    } catch (error) {
      return failed(base, error instanceof Error ? error.message : "The document classification could not be saved.");
    }

    return {
      ...base,
      supplierName: draft.supplierName ?? candidate.supplierName,
      invoiceNumber,
      invoiceDate,
      outcome: "skipped",
      invoiceId: null,
      extractionFailed: false,
      detail: hold.detail,
    };
  }

  const inserted = await input.db.insertInvoice({
    supplier_id: supplierId,
    raw_supplier_name: draft.rawSupplierName ?? candidate.supplierName,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    subtotal: draft.subtotal,
    vat: draft.vat,
    total: draft.total,
    currency: "GBP",
    extraction_status: draft.extractionStatus,
    processing_status: draft.processingStatus,
    source_type: GMAIL_IMPORT_SOURCE,
    source_identifier: checksum,
    gmail_import_item_id: candidate.itemId,
    extraction_warnings: draft.warnings,
    created_by: input.userId,
  });

  if ("error" in inserted) {
    const raced = duplicateFromWriteError(inserted.error);

    if (raced) {
      return {
        ...base,
        invoiceNumber,
        invoiceDate,
        outcome: "duplicate",
        invoiceId: raced.invoiceId,
        extractionFailed: false,
        detail: raced.detail,
      };
    }

    return failed(base, inserted.error?.message || "The review record could not be stored.");
  }

  const invoiceId = inserted.id;
  const storagePath = `${invoiceId}/${checksum.slice(0, 16)}-${safeFileName(candidate.filename)}`;
  const uploadError = await input.files.upload(storagePath, bytes, candidate.mimeType);

  if (uploadError) {
    const undo = await undoPromotion(input.db, input.files, invoiceId, null);
    return failed(base, joinProblems(uploadError.message || "The invoice copy could not be stored.", undo));
  }

  const fileError = await input.db.insertFile({
    invoice_id: invoiceId,
    storage_path: storagePath,
    original_filename: candidate.filename,
    mime_type: candidate.mimeType,
    byte_size: bytes.byteLength,
    checksum_sha256: checksum,
  });

  if (fileError) {
    const raced = duplicateFromWriteError(fileError);
    const undo = await undoPromotion(input.db, input.files, invoiceId, storagePath);

    if (raced) {
      return {
        ...base,
        invoiceNumber,
        invoiceDate,
        outcome: "duplicate",
        invoiceId: raced.invoiceId,
        extractionFailed: false,
        detail: joinProblems(raced.detail, undo),
      };
    }

    return failed(base, joinProblems(fileError.message || "The invoice file record could not be stored.", undo));
  }

  let retainedPrices = 0;

  if (draft.lines.length > 0) {
    const lineError = await input.db.insertLines(
      draft.lines.map((line) => ({
        invoice_id: invoiceId,
        line_number: line.lineNumber,
        raw_description: line.rawDescription,
        raw_supplier_sku: line.rawSupplierSku,
        raw_quantity: line.rawQuantity,
        raw_unit: line.rawUnit,
        raw_unit_price: line.rawUnitPrice,
        raw_line_total: line.rawLineTotal,
        raw_tax: line.rawTax,
        matched_supplier_product_id: line.matchedProductId,
        match_confidence: line.matchConfidence,
        match_method: line.matchMethod,
        review_status: line.reviewStatus,
        maths_warning: line.mathsWarning,
        internal_note: line.note,
      }))
    );

    if (lineError) {
      const undo = await undoPromotion(input.db, input.files, invoiceId, storagePath);
      return failed(base, joinProblems(lineError.message || "The invoice lines could not be stored.", undo));
    }

    let storedLines: Awaited<ReturnType<PromotionDatabase["listLines"]>> = [];

    try {
      storedLines = await input.db.listLines(invoiceId);
    } catch {
      storedLines = [];
    }

    try {
      await recordPriceChangeDetections(eventsClient(input.db), {
        invoiceId,
        actorId: input.userId,
        invoiceDate,
        lines: storedLines.map((stored) => {
          const classified = draft.lines.find((line) => line.lineNumber === stored.line_number);
          return {
            id: stored.id,
            previousStatus: null,
            reviewStatus: stored.review_status,
            productId: stored.matched_supplier_product_id,
            comparison: classified?.comparison ?? null,
          };
        }),
      });
    } catch {
      // The review lines are already stored. A retry finds the Gmail item link.
    }

    try {
      retainedPrices = await retainHistoricalPriceLines({
        db: input.db,
        userId: input.userId,
        supplierId,
        invoiceDate,
        extractionStatus: draft.extractionStatus,
        draftLines: draft.lines,
        storedLines,
        catalog: input.catalog,
      });
    } catch {
      retainedPrices = 0;
    }
  }

  const extractionFailed =
    draft.extractionStatus !== "extracted" || draft.lines.length === 0 || draft.processingStatus === "extraction_error";

  try {
    await input.db.insertEvents([
    {
      invoice_id: invoiceId,
      invoice_line_id: null,
      actor_id: input.userId,
      action: "invoice_uploaded",
      metadata: {
        filename: candidate.filename,
        checksum,
        source: GMAIL_IMPORT_SOURCE,
        gmailImportItemId: candidate.itemId,
        gmailMessageId: candidate.gmailMessageId,
        gmailAttachmentId: candidate.gmailAttachmentId,
      },
    },
    {
      invoice_id: invoiceId,
      invoice_line_id: null,
      actor_id: input.userId,
      action: extractionFailed ? "extraction_failed" : "extraction_completed",
      metadata: {
        extractionStatus: draft.extractionStatus,
        processingStatus: draft.processingStatus,
        lineCount: draft.lines.length,
        invoiceDate,
        warnings: draft.warnings,
      },
    },
  ]);
  } catch {
    // The review record and copied file are already stored.
  }

  return {
    ...base,
    supplierName: draft.supplierName ?? candidate.supplierName,
    supplierId,
    invoiceNumber,
    invoiceDate,
    outcome: "promoted",
    invoiceId,
    extractionFailed,
    detail: extractionFailed
      ? "Promoted for manual review. Line extraction did not produce invoice lines."
      : retainedPrices > 0
        ? "Promoted into supplier invoice review. Historical prices were retained. No catalogue prices were changed."
        : "Promoted into supplier invoice review. No catalogue prices were changed.",
  };
}

const PROMOTION_ITEM_COLUMNS =
  "id, document_type, status, supplier_id, invoice_number, invoice_date, filename, gmail_message_id, gmail_attachment_id, detail";

type SupplierDirectoryRow = { id: string; name: string; autoProcessing: boolean };

type PromotionItemRow = {
  id: string;
  document_type: string;
  status: string;
  supplier_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  filename: string;
  gmail_message_id: string;
  gmail_attachment_id: string;
  detail: string | null;
  promotion_relevance: string | null;
};

async function loadSupplierDirectory(supabase: SupabaseClient) {
  const withFlag = await supabase.from("suppliers").select("id, name, gmail_auto_processing_enabled");

  if (withFlag.error && postgresColumnMissing(withFlag.error, "gmail_auto_processing_enabled")) {
    const fallback = await supabase.from("suppliers").select("id, name");

    return {
      error: fallback.error,
      suppliers: ((fallback.data ?? []) as Array<{ id: string; name: string }>).map((row) => ({
        id: row.id,
        name: row.name,
        autoProcessing: false,
      })),
    };
  }

  return {
    error: withFlag.error,
    suppliers: (
      (withFlag.data ?? []) as Array<{ id: string; name: string; gmail_auto_processing_enabled: boolean | null }>
    ).map((row) => ({
      id: row.id,
      name: row.name,
      autoProcessing: Boolean(row.gmail_auto_processing_enabled),
    })),
  };
}

async function loadPromotionItemRows(supabase: SupabaseClient, itemIds?: readonly string[]) {
  const filtered = (columns: string) => {
    const query = supabase.from("gmail_import_items").select(columns);

    if (itemIds) {
      return query.in("id", [...itemIds]);
    }

    return query
      .or(
        "and(document_type.eq.invoice,status.eq.stored),detail.ilike.Excluded as irrelevant%,detail.ilike.Needs manual classification%,detail.ilike.Marked as not a supplier invoice%"
      )
      .limit(1000);
  };
  const withRelevance = await filtered(`${PROMOTION_ITEM_COLUMNS}, promotion_relevance`);

  if (withRelevance.error && postgresColumnMissing(withRelevance.error, "promotion_relevance")) {
    const fallback = await filtered(PROMOTION_ITEM_COLUMNS);

    return {
      error: fallback.error,
      items: ((fallback.data ?? []) as unknown as Omit<PromotionItemRow, "promotion_relevance">[]).map((row) => ({
        ...row,
        promotion_relevance: null,
      })),
    };
  }

  return {
    error: withRelevance.error,
    items: (withRelevance.data ?? []) as unknown as PromotionItemRow[],
  };
}

function candidateFromItem(
  item: PromotionItemRow,
  file:
    | {
        original_filename?: string | null;
        storage_path?: string | null;
        checksum_sha256?: string | null;
        mime_type?: string | null;
        byte_size?: number | null;
      }
    | undefined,
  suppliers: readonly SupplierDirectoryRow[]
): PromotionCandidate {
  const supplier = item.supplier_id ? suppliers.find((row) => row.id === item.supplier_id) : undefined;

  return {
    itemId: item.id,
    documentType: item.document_type,
    status: item.status,
    supplierId: item.supplier_id,
    supplierName: supplier?.name ?? null,
    supplierApproved: Boolean(supplier?.autoProcessing),
    relevance: storedDocumentRelevance({
      promotionRelevance: item.promotion_relevance,
      detail: item.detail,
    }),
    detail: item.detail,
    invoiceNumber: item.invoice_number,
    invoiceDate: item.invoice_date,
    filename: file?.original_filename || item.filename,
    gmailMessageId: item.gmail_message_id,
    gmailAttachmentId: item.gmail_attachment_id,
    storagePath: file?.storage_path ?? null,
    checksumSha256: file?.checksum_sha256 ?? null,
    mimeType: file?.mime_type ?? null,
    byteSize: file?.byte_size ?? null,
  };
}

export async function loadGmailPromotionPreview(supabase: SupabaseClient) {
  const [items, files, suppliers, invoices, invoiceFiles] = await Promise.all([
    loadPromotionItemRows(supabase),
    supabase
      .from("gmail_import_files")
      .select("item_id, storage_path, checksum_sha256, mime_type, byte_size, original_filename")
      .limit(1000),
    loadSupplierDirectory(supabase),
    supabase
      .from("supplier_invoices")
      .select("id, supplier_id, invoice_number, invoice_date, gmail_import_item_id")
      .limit(1000),
    supabase.from("supplier_invoice_files").select("invoice_id, checksum_sha256").limit(1000),
  ]);
  const error = items.error ?? files.error ?? suppliers.error ?? invoices.error ?? invoiceFiles.error;

  if (error) {
    return {
      ok: false as const,
      error: isMaterialsSchemaMissing(error) ? MIGRATION_MESSAGE : "Stored Gmail invoices could not be loaded.",
    };
  }

  const filesByItem = new Map((files.data ?? []).map((file) => [file.item_id, file]));
  const checksumByInvoice = new Map(
    (invoiceFiles.data ?? []).map((file) => [file.invoice_id, file.checksum_sha256])
  );
  const candidates = items.items.map((item) => candidateFromItem(item, filesByItem.get(item.id), suppliers.suppliers));

  return {
    ok: true as const,
    rows: buildPromotionPreview({
      candidates,
      existing: (invoices.data ?? []).map((invoice) => ({
        id: invoice.id,
        supplierId: invoice.supplier_id,
        invoiceNumber: invoice.invoice_number,
        invoiceDate: invoice.invoice_date,
        checksumSha256: checksumByInvoice.get(invoice.id) ?? "",
        gmailImportItemId: invoice.gmail_import_item_id,
      })),
    }),
  };
}

export async function promoteGmailInvoiceBatch(input: {
  supabase: SupabaseClient;
  userId: string;
  itemIds: readonly string[];
  catalog: PromotionCatalog;
  mode?: "automatic" | "manual";
}) {
  const itemIds = assertPromotionBatch(input.itemIds);
  const [items, files, suppliers, invoices, invoiceFiles] = await Promise.all([
    loadPromotionItemRows(input.supabase, itemIds),
    input.supabase
      .from("gmail_import_files")
      .select("item_id, storage_path, checksum_sha256, mime_type, byte_size, original_filename")
      .in("item_id", itemIds),
    loadSupplierDirectory(input.supabase),
    input.supabase
      .from("supplier_invoices")
      .select("id, supplier_id, invoice_number, invoice_date, gmail_import_item_id")
      .limit(1000),
    input.supabase.from("supplier_invoice_files").select("invoice_id, checksum_sha256").limit(1000),
  ]);
  const error = items.error ?? files.error ?? suppliers.error ?? invoices.error ?? invoiceFiles.error;

  if (error) {
    throw new Error(isMaterialsSchemaMissing(error) ? MIGRATION_MESSAGE : "Stored Gmail invoices could not be loaded.");
  }

  const filesByItem = new Map((files.data ?? []).map((file) => [file.item_id, file]));
  const candidates = items.items.map((item) => candidateFromItem(item, filesByItem.get(item.id), suppliers.suppliers));
  const checksumByInvoice = new Map(
    (invoiceFiles.data ?? []).map((file) => [file.invoice_id, file.checksum_sha256])
  );
  const existing: PromotionExistingInvoice[] = (invoices.data ?? []).map((invoice) => ({
    id: invoice.id,
    supplierId: invoice.supplier_id,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    checksumSha256: checksumByInvoice.get(invoice.id) ?? "",
    gmailImportItemId: invoice.gmail_import_item_id,
  }));

  return runPromotionBatch({
    itemIds,
    candidates,
    catalog: input.catalog,
    existing,
    userId: input.userId,
    files: supabasePromotionFiles(input.supabase),
    db: supabasePromotionDatabase(input.supabase),
    mode: input.mode,
  });
}

function supabasePromotionFiles(supabase: SupabaseClient): PromotionFiles {
  return {
    async download(path) {
      const downloaded = await supabase.storage.from(GMAIL_IMPORT_FILES_BUCKET).download(path);

      if (downloaded.error || !downloaded.data) {
        throw new Error("The stored PDF could not be read from private storage.");
      }

      return new Uint8Array(await downloaded.data.arrayBuffer());
    },
    async upload(path, bytes, mimeType) {
      const uploaded = await supabase.storage
        .from(SUPPLIER_INVOICE_FILES_BUCKET)
        .upload(path, bytes, { contentType: mimeType, upsert: false });
      return uploaded.error;
    },
    async remove(path) {
      await supabase.storage.from(SUPPLIER_INVOICE_FILES_BUCKET).remove([path]);
    },
  };
}

function supabasePromotionDatabase(supabase: SupabaseClient): PromotionDatabase {
  return {
    async insertInvoice(row) {
      const { data, error } = await supabase.from("supplier_invoices").insert(row).select("id").single();

      if (error || !data) {
        return { error };
      }

      return { id: data.id as string };
    },
    async deleteInvoice(invoiceId) {
      const { error } = await supabase.from("supplier_invoices").delete().eq("id", invoiceId);

      if (error) {
        throw new Error("The incomplete review record could not be removed.");
      }
    },
    async insertFile(row) {
      const { error } = await supabase.from("supplier_invoice_files").insert(row);
      return error;
    },
    async insertLines(rows) {
      const { error } = await supabase.from("supplier_invoice_lines").insert(rows);
      return error;
    },
    async insertEvents(rows) {
      if (rows.length === 0) {
        return;
      }

      await supabase.from("supplier_invoice_events").insert(rows);
    },
    async markDocument(itemId, update) {
      const withRelevance = await supabase
        .from("gmail_import_items")
        .update({
          status: update.status,
          detail: update.detail,
          promotion_relevance: update.relevance,
        })
        .eq("id", itemId);

      if (withRelevance.error && postgresColumnMissing(withRelevance.error, "promotion_relevance")) {
        const fallback = await supabase
          .from("gmail_import_items")
          .update({ status: update.status, detail: update.detail })
          .eq("id", itemId);

        if (fallback.error) {
          throw new Error("The document classification could not be saved.");
        }

        return;
      }

      if (withRelevance.error) {
        throw new Error("The document classification could not be saved.");
      }
    },
    async listLines(invoiceId) {
      const { data, error } = await supabase
        .from("supplier_invoice_lines")
        .select("id, line_number, review_status, matched_supplier_product_id")
        .eq("invoice_id", invoiceId);

      if (error) {
        throw new Error("The stored invoice lines could not be read.");
      }

      return data ?? [];
    },
    async retainHistoricalPrice(input) {
      const { data, error } = await supabase.rpc("retain_historical_invoice_price", {
        p_invoice_line_id: input.lineId,
        p_expected_product_id: input.productId,
        p_expected_price_id: input.priceId,
        p_expected_invoice_price: input.invoicePrice,
        p_actor_id: input.actorId,
      });

      if (error) {
        return { ok: false as const, error: error.message };
      }

      const body = data as { alreadyResolved?: boolean } | null;
      return { ok: true as const, alreadyResolved: Boolean(body?.alreadyResolved) };
    },
  };
}

export async function retainHistoricalPriceLines(input: {
  db: PromotionDatabase;
  userId: string;
  supplierId: string | null;
  invoiceDate: string | null;
  extractionStatus: InvoiceExtractionStatus;
  draftLines: Parameters<typeof historicalPriceDecision>[0]["line"][];
  storedLines: Awaited<ReturnType<PromotionDatabase["listLines"]>>;
  catalog: PromotionCatalog;
}) {
  if (!input.db.retainHistoricalPrice || !input.supplierId) {
    return 0;
  }

  let retained = 0;

  for (const stored of input.storedLines) {
    if (stored.review_status !== "price_change" || !stored.matched_supplier_product_id) {
      continue;
    }

    const line = input.draftLines.find((item) => item.lineNumber === stored.line_number);
    const product = input.catalog.products.find((item) => item.id === stored.matched_supplier_product_id) ?? null;

    if (!line || !product) {
      continue;
    }

    const decision = historicalPriceDecision({
      extractionStatus: input.extractionStatus,
      invoiceDate: input.invoiceDate,
      supplierId: input.supplierId,
      line,
      product,
      productActive: true,
      supplierProducts: input.catalog.products.filter((item) => item.supplierId === input.supplierId),
      mappings: input.catalog.mappings,
      prices: (input.catalog.prices ?? [])
        .filter((price) => price.productId === product.id)
        .map((price) => ({
          id: price.id,
          price: price.price,
          priceUnit: price.priceUnit,
          effectiveDate: price.effectiveDate,
          approvedAt: price.approvedAt,
          createdAt: price.createdAt,
        })),
    });

    if (!decision.retain) {
      continue;
    }

    try {
      const result = await input.db.retainHistoricalPrice({
        lineId: stored.id,
        productId: decision.productId,
        priceId: decision.priceId,
        invoicePrice: decision.invoicePrice,
        actorId: input.userId,
      });

      if (result.ok) {
        retained += 1;
      }
    } catch {
      // A failed audit write leaves the line on manual price review.
    }
  }

  return retained;
}

function eventsClient(db: PromotionDatabase): SupabaseClient {
  return {
    from(table: string) {
      if (table !== "supplier_invoice_events") {
        throw new Error(`Promotion must not write ${table}.`);
      }

      return {
        insert: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          await db.insertEvents(Array.isArray(rows) ? rows : [rows]);
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function duplicateFromWriteError(error: WriteError): PromotionBlock | null {
  if (!error || error.code !== "23505") {
    return null;
  }

  const message = error.message ?? "";

  if (message.includes("gmail_import_item")) {
    return {
      kind: "already_promoted",
      invoiceId: null,
      detail: "This Gmail invoice is already in review.",
    };
  }

  if (message.includes("checksum")) {
    return {
      kind: "checksum",
      invoiceId: null,
      detail: "This file has already been uploaded.",
    };
  }

  if (message.includes("supplier") || message.includes("invoice_number")) {
    return {
      kind: "invoice_number",
      invoiceId: null,
      detail: "An invoice with this supplier and invoice number is already stored.",
    };
  }

  return null;
}

async function undoPromotion(
  db: PromotionDatabase,
  files: PromotionFiles,
  invoiceId: string,
  storagePath: string | null
) {
  const problems: string[] = [];

  if (storagePath) {
    try {
      await files.remove(storagePath);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "The copied file could not be removed.");
    }
  }

  try {
    await db.deleteInvoice(invoiceId);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "The incomplete review record could not be removed.");
  }

  return problems;
}

function comparePromotionRows(left: PromotionPreviewRow, right: PromotionPreviewRow) {
  if (left.pyramid !== right.pyramid) {
    return left.pyramid ? -1 : 1;
  }

  const date = (left.invoiceDate ?? "9999-99-99").localeCompare(right.invoiceDate ?? "9999-99-99");

  if (date !== 0) {
    return date;
  }

  return left.filename.localeCompare(right.filename);
}

function promotionHold(input: {
  mode: "automatic" | "manual";
  relevance: ReturnType<typeof classifyDocumentRelevance>;
  supplierMatched: boolean;
  supplierApproved: boolean;
}) {
  if (input.relevance.relevance === "irrelevant") {
    return {
      detail: input.relevance.reason,
      mark: {
        status: "skipped" as const,
        detail: input.relevance.reason,
        relevance: "irrelevant" as const,
      },
    };
  }

  if (input.mode === "manual") {
    return null;
  }

  if (!input.supplierMatched || !input.supplierApproved || input.relevance.relevance !== "supplier_invoice") {
    const detail = !input.supplierMatched
      ? "Needs manual classification. The supplier is not matched."
      : !input.supplierApproved
        ? "Needs manual classification. This supplier is not approved for automatic processing."
        : input.relevance.reason;

    return {
      detail,
      mark: {
        status: "stored" as const,
        detail,
        relevance: "needs_review" as const,
      },
    };
  }

  return null;
}

function summarise(results: readonly PromotionOutcome[]): PromotionReport {
  return {
    promoted: results.filter((result) => result.outcome === "promoted").length,
    duplicate: results.filter((result) => result.outcome === "duplicate").length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
    failed: results.filter((result) => result.outcome === "failed").length,
    results: [...results],
  };
}

function skipped(itemId: string, detail: string): PromotionOutcome {
  return {
    itemId,
    filename: "",
    supplierName: null,
    invoiceNumber: null,
    invoiceDate: null,
    outcome: "skipped",
    invoiceId: null,
    extractionFailed: false,
    detail,
  };
}

function failed(
  base: Pick<PromotionOutcome, "itemId" | "filename" | "supplierName" | "invoiceNumber" | "invoiceDate">,
  detail: string
): PromotionOutcome {
  return {
    ...base,
    outcome: "failed",
    invoiceId: null,
    extractionFailed: false,
    detail,
  };
}

function joinProblems(detail: string, problems: string[]) {
  return [detail, ...problems].filter(Boolean).join(" ");
}

function safeFileName(filename: string) {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 80) || "invoice.pdf";
}
