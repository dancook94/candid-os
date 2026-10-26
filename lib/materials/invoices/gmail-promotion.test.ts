import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assertPromotionBatch,
  buildPromotionPreview,
  GMAIL_IMPORT_SOURCE,
  promoteGmailInvoiceBatch,
  requireGmailPromotionAccess,
  runPromotionBatch,
  selectPyramidPilot,
  type PromotionCandidate,
  type PromotionCatalog,
  type PromotionDatabase,
  type PromotionExistingInvoice,
  type PromotionFiles,
} from "@/lib/materials/invoices/gmail-promotion";

const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
const CHECKSUM = createHash("sha256").update(PDF).digest("hex");

const catalog: PromotionCatalog = {
  suppliers: [
    {
      id: "pyramid",
      name: "Pyramid Display Materials",
      normalizedName: "pyramid display materials",
    },
  ],
  aliases: [],
  products: [],
  mappings: [],
  ignoreRules: [],
};

const invoiceText = `Supplier: Pyramid Display Materials
Invoice number: SI100
Invoice date: 29 September 2026
No. Description Quantity Unit
BLMV137MWPC Example board 1 Roll 10.00 20 10.00
Subtotal 10.00
20% VAT 2.00
Total 12.00
`;

function candidate(overrides: Partial<PromotionCandidate> = {}): PromotionCandidate {
  return {
    itemId: "item-1",
    documentType: "invoice",
    status: "stored",
    supplierId: "pyramid",
    supplierName: "Pyramid Display Materials",
    invoiceNumber: "SI100",
    invoiceDate: "2026-09-29",
    filename: "SI100.pdf",
    gmailMessageId: "message-1",
    gmailAttachmentId: "attachment-1",
    storagePath: "item-1/file.pdf",
    checksumSha256: CHECKSUM,
    mimeType: "application/pdf",
    byteSize: PDF.byteLength,
    ...overrides,
  };
}

function harness(options?: {
  uploadError?: string;
  lineError?: string;
  deleteError?: boolean;
  bytes?: Uint8Array;
}) {
  const invoices: Record<string, unknown>[] = [];
  const files: Record<string, unknown>[] = [];
  const lines: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const removed: string[] = [];
  let downloads = 0;
  let ids = 0;
  const db: PromotionDatabase = {
    async insertInvoice(row) {
      if ("material_prices" in row || row.source_type !== GMAIL_IMPORT_SOURCE) {
        throw new Error("Unexpected invoice write.");
      }
      ids += 1;
      const id = `invoice-${ids}`;
      invoices.push({ id, ...row });
      return { id };
    },
    async deleteInvoice(invoiceId) {
      if (options?.deleteError) {
        throw new Error("Delete failed.");
      }
      const index = invoices.findIndex((invoice) => invoice.id === invoiceId);
      if (index >= 0) {
        invoices.splice(index, 1);
      }
    },
    async insertFile(row) {
      files.push(row);
      return null;
    },
    async insertLines(rows) {
      if (options?.lineError) {
        return { message: options.lineError };
      }
      lines.push(...rows);
      return null;
    },
    async insertEvents(rows) {
      events.push(...rows);
    },
    async listLines(invoiceId) {
      return lines
        .filter((line) => line.invoice_id === invoiceId)
        .map((line, index) => ({
          id: `line-${index}`,
          line_number: Number(line.line_number),
          review_status: String(line.review_status),
          matched_supplier_product_id: (line.matched_supplier_product_id as string | null) ?? null,
        }));
    },
  };
  const storage: PromotionFiles = {
    async download() {
      downloads += 1;
      return options?.bytes ?? PDF;
    },
    async upload() {
      return options?.uploadError ? { message: options.uploadError } : null;
    },
    async remove(path) {
      removed.push(path);
    },
  };

  return { db, storage, invoices, files, lines, events, removed, downloads: () => downloads };
}

function authClient(input: { user?: { id: string } | null; role?: string; status?: string }) {
  return {
    auth: {
      async getUser() {
        return { data: { user: input.user === undefined ? { id: "admin-1" } : input.user } };
      },
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async single() {
          return {
            data: input.role
              ? { user_role: input.role, account_status: input.status ?? "approved" }
              : null,
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

test("preview lists Pyramid invoices first and marks duplicates", () => {
  const rows = buildPromotionPreview({
    candidates: [
      candidate({
        itemId: "antalis",
        supplierId: "antalis",
        supplierName: "Antalis",
        invoiceNumber: "A1",
        invoiceDate: "2026-08-01",
        filename: "antalis.pdf",
      }),
      candidate({ itemId: "credit", documentType: "credit_note", filename: "credit.pdf" }),
      candidate({
        itemId: "pyramid-late",
        invoiceDate: "2026-10-01",
        invoiceNumber: "SI200",
        filename: "later.pdf",
      }),
      candidate({ itemId: "pyramid-early", invoiceDate: "2026-07-20", filename: "early.pdf" }),
      candidate({
        itemId: "same-file",
        supplierId: null,
        supplierName: null,
        checksumSha256: "abc",
        invoiceNumber: "SI9",
        invoiceDate: null,
        filename: "dup.pdf",
      }),
    ],
    existing: [
      {
        id: "manual-1",
        supplierId: "pyramid",
        invoiceNumber: "SI100",
        invoiceDate: "2026-09-29",
        checksumSha256: "abc",
        gmailImportItemId: null,
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.itemId),
    ["pyramid-early", "pyramid-late", "antalis", "same-file"]
  );
  assert.equal(rows[0]?.duplicate, null);
  assert.equal(rows[3]?.duplicate?.kind, "checksum");
  assert.equal(rows[3]?.selectable, false);
  assert.deepEqual(selectPyramidPilot(rows, 1), ["pyramid-early"]);
});

test("an approved administrator can promote and other accounts cannot", async () => {
  assert.equal((await requireGmailPromotionAccess(authClient({ user: null }))).ok, false);
  const staff = await requireGmailPromotionAccess(
    authClient({ role: "production", status: "approved" })
  );
  const pending = await requireGmailPromotionAccess(
    authClient({ role: "admin", status: "pending" })
  );
  const admin = await requireGmailPromotionAccess(authClient({ role: "admin", status: "approved" }));

  assert.equal(staff.ok, false);
  assert.equal(pending.ok, false);
  assert.equal(admin.ok, true);
  if (admin.ok) {
    assert.equal(admin.userId, "admin-1");
  }
});

test("promotion keeps the Gmail link, invoice date, and does not write catalogue prices", async () => {
  const state = harness();
  const report = await runPromotionBatch({
    itemIds: ["item-1"],
    candidates: [candidate()],
    catalog,
    existing: [],
    userId: "admin-1",
    files: state.storage,
    db: state.db,
    extract: async () => ({ text: invoiceText, extractionStatus: "extracted", warnings: [] }),
  });

  assert.equal(report.promoted, 1);
  assert.equal(report.results[0]?.extractionFailed, false);
  assert.equal(report.results[0]?.invoiceDate, "2026-09-29");
  assert.equal(state.invoices[0]?.source_type, GMAIL_IMPORT_SOURCE);
  assert.equal(state.invoices[0]?.gmail_import_item_id, "item-1");
  assert.equal(state.invoices[0]?.invoice_date, "2026-09-29");
  assert.equal(state.files.length, 1);
  assert.equal(state.lines.length, 1);
  const uploaded = state.events.find((event) => event.action === "invoice_uploaded");
  assert.equal((uploaded?.metadata as { gmailMessageId?: string }).gmailMessageId, "message-1");
  assert.equal(
    (uploaded?.metadata as { gmailAttachmentId?: string }).gmailAttachmentId,
    "attachment-1"
  );
  assert.equal(
    state.events.some((event) => String(event.action).includes("material")),
    false
  );

  const retry = await runPromotionBatch({
    itemIds: ["item-1"],
    candidates: [candidate()],
    catalog,
    existing: [
      {
        id: "invoice-1",
        supplierId: "pyramid",
        invoiceNumber: "SI100",
        invoiceDate: "2026-09-29",
        checksumSha256: CHECKSUM,
        gmailImportItemId: "item-1",
      },
    ],
    userId: "admin-1",
    files: state.storage,
    db: state.db,
  });

  assert.equal(retry.duplicate, 1);
  assert.equal(retry.results[0]?.detail, "This Gmail invoice is already in review.");
  assert.equal(state.downloads(), 1);
  assert.equal(state.invoices.length, 1);
});

test("checksum and supplier invoice number duplicates are not inserted", async () => {
  const existing: PromotionExistingInvoice[] = [
    {
      id: "manual-1",
      supplierId: "pyramid",
      invoiceNumber: "SI100",
      invoiceDate: "2026-09-29",
      checksumSha256: CHECKSUM,
      gmailImportItemId: null,
    },
  ];
  const checksum = harness();
  const checksumReport = await runPromotionBatch({
    itemIds: ["item-1"],
    candidates: [candidate()],
    catalog,
    existing,
    userId: "admin-1",
    files: checksum.storage,
    db: checksum.db,
  });
  assert.equal(checksumReport.duplicate, 1);
  assert.equal(checksum.downloads(), 0);
  assert.equal(checksum.invoices.length, 0);

  const numbered = harness();
  const numberReport = await runPromotionBatch({
    itemIds: ["item-2"],
    candidates: [candidate({ itemId: "item-2", checksumSha256: "f".repeat(64) })],
    catalog,
    existing,
    userId: "admin-1",
    files: numbered.storage,
    db: numbered.db,
  });
  assert.equal(numberReport.results[0]?.outcome, "duplicate");
  assert.match(numberReport.results[0]?.detail ?? "", /invoice number/);
  assert.equal(numbered.downloads(), 0);
});

test("a missing invoice date on the PDF keeps the discovered invoice date", async () => {
  const state = harness();
  const report = await runPromotionBatch({
    itemIds: ["item-1"],
    candidates: [candidate({ invoiceNumber: null, invoiceDate: "2026-09-29" })],
    catalog,
    existing: [],
    userId: "admin-1",
    files: state.storage,
    db: state.db,
    extract: async () => ({ text: "Packing list only", extractionStatus: "extracted", warnings: [] }),
  });

  assert.equal(report.promoted, 1);
  assert.equal(report.results[0]?.extractionFailed, true);
  assert.equal(state.invoices[0]?.invoice_date, "2026-09-29");
  assert.equal(state.lines.length, 0);
  assert.equal(
    state.events.some((event) => event.action === "extraction_failed"),
    true
  );
});

test("a file-copy failure removes the review record and a line failure removes the copy", async () => {
  const upload = harness({ uploadError: "copy failed" });
  const uploadReport = await runPromotionBatch({
    itemIds: ["item-1"],
    candidates: [candidate()],
    catalog,
    existing: [],
    userId: "admin-1",
    files: upload.storage,
    db: upload.db,
    extract: async () => ({ text: invoiceText, extractionStatus: "extracted", warnings: [] }),
  });
  assert.equal(uploadReport.failed, 1);
  assert.match(uploadReport.results[0]?.detail ?? "", /copy failed/);
  assert.equal(upload.invoices.length, 0);
  assert.equal(upload.files.length, 0);

  const lines = harness({ lineError: "lines failed" });
  const lineReport = await runPromotionBatch({
    itemIds: ["item-1"],
    candidates: [candidate()],
    catalog,
    existing: [],
    userId: "admin-1",
    files: lines.storage,
    db: lines.db,
    extract: async () => ({ text: invoiceText, extractionStatus: "extracted", warnings: [] }),
  });
  assert.equal(lineReport.failed, 1);
  assert.match(lineReport.results[0]?.detail ?? "", /lines failed/);
  assert.equal(lines.invoices.length, 0);
  assert.equal(lines.removed.length, 1);
});

test("a failed download and a unique-link race do not create a second review record", async () => {
  const download = harness();
  const downloadReport = await runPromotionBatch({
    itemIds: ["item-1"],
    candidates: [candidate()],
    catalog,
    existing: [],
    userId: "admin-1",
    files: {
      ...download.storage,
      async download() {
        throw new Error("Private storage did not return the PDF.");
      },
    },
    db: download.db,
  });
  assert.equal(downloadReport.failed, 1);
  assert.equal(download.invoices.length, 0);

  const raced = harness();
  raced.db.insertInvoice = async () => ({
    error: { code: "23505", message: 'duplicate key value violates unique constraint "supplier_invoices_gmail_import_item_idx"' },
  });
  const racedReport = await runPromotionBatch({
    itemIds: ["item-1"],
    candidates: [candidate()],
    catalog,
    existing: [],
    userId: "admin-1",
    files: raced.storage,
    db: raced.db,
    extract: async () => ({ text: invoiceText, extractionStatus: "extracted", warnings: [] }),
  });
  assert.equal(racedReport.duplicate, 1);
  assert.equal(racedReport.results[0]?.detail, "This Gmail invoice is already in review.");
  assert.equal(raced.files.length, 0);
});

test("a checksum mismatch and non-invoice documents do not create review records", async () => {
  const mismatch = harness({ bytes: new Uint8Array([1, 2, 3]) });
  const mismatchReport = await runPromotionBatch({
    itemIds: ["item-1"],
    candidates: [candidate()],
    catalog,
    existing: [],
    userId: "admin-1",
    files: mismatch.storage,
    db: mismatch.db,
  });
  assert.equal(mismatchReport.failed, 1);
  assert.match(mismatchReport.results[0]?.detail ?? "", /checksum/);
  assert.equal(mismatch.invoices.length, 0);

  const skipped = harness();
  const skippedReport = await runPromotionBatch({
    itemIds: ["credit-1", "image-1"],
    candidates: [
      candidate({ itemId: "credit-1", documentType: "credit_note" }),
      candidate({ itemId: "image-1", mimeType: "image/jpeg", filename: "scan.jpg" }),
    ],
    catalog,
    existing: [],
    userId: "admin-1",
    files: skipped.storage,
    db: skipped.db,
  });
  assert.equal(skippedReport.skipped, 2);
  assert.equal(skipped.downloads(), 0);
  assert.equal(skipped.invoices.length, 0);
});

test("a batch stops before any write when more than 10 invoices are chosen, and continues after one failure", async () => {
  assert.throws(() => assertPromotionBatch(Array.from({ length: 11 }, (_, index) => `item-${index}`)));
  const state = harness();
  await assert.rejects(
    runPromotionBatch({
      itemIds: Array.from({ length: 11 }, (_, index) => `item-${index}`),
      candidates: [],
      catalog,
      existing: [],
      userId: "admin-1",
      files: state.storage,
      db: state.db,
    })
  );
  assert.equal(state.downloads(), 0);

  let uploads = 0;
  const partialFiles: PromotionFiles = {
    ...state.storage,
    async upload() {
      uploads += 1;
      return uploads === 1 ? { message: "first copy failed" } : null;
    },
  };
  const partial = await runPromotionBatch({
    itemIds: ["item-1", "item-2"],
    candidates: [
      candidate(),
      candidate({
        itemId: "item-2",
        invoiceNumber: "SI200",
        filename: "SI200.pdf",
        gmailMessageId: "message-2",
        gmailAttachmentId: "attachment-2",
        storagePath: "item-2/file.pdf",
      }),
    ],
    catalog,
    existing: [],
    userId: "admin-1",
    files: partialFiles,
    db: state.db,
    extract: async () => ({ text: invoiceText, extractionStatus: "extracted", warnings: [] }),
  });

  assert.equal(partial.failed, 1);
  assert.equal(partial.promoted, 1);
  assert.equal(state.invoices.length, 1);
});

test("the promotion migration allows gmail_import without changing prices", async () => {
  const sql = await readFile(
    new URL("../../../supabase/migrations/20261026120000_gmail_invoice_promotion.sql", import.meta.url),
    "utf8"
  );

  assert.match(sql, /source_type IN \('manual_upload', 'gmail_import'\)/);
  assert.match(sql, /gmail_import_item_id uuid/);
  assert.match(sql, /supplier_invoices_gmail_import_item_idx/);
  assert.match(sql, /WHERE gmail_import_item_id IS NOT NULL/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.material_|INSERT INTO public\.material_|UPDATE public\.material_/);
});

test("promotion code does not create materials or approved prices", async () => {
  const source = await readFile(new URL("./gmail-promotion.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /from\("material_prices"\)|from\("materials"\)|from\("material_supplier_products"\)/);
  assert.doesNotMatch(source, /create_material_from_invoice_line|approve_invoice_price_change/);
  assert.equal(promoteGmailInvoiceBatch.name, "promoteGmailInvoiceBatch");
});
