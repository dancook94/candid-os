import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { parseInvoiceText } from "@/lib/materials/invoices/parse";
import { resolveInvoiceSupplier } from "@/lib/materials/invoices/supplier";
import type { InvoiceAliasRef, InvoiceSupplierRef } from "@/lib/materials/invoices/model";

import { collectAttachments } from "@/lib/gmail/attachments";
import type { GmailDiscoveryClient } from "@/lib/gmail/client";
import { createGmailApiClient } from "@/lib/gmail/client";
import { refreshStoredGmailAccessToken } from "@/lib/gmail/connection";
import {
  GMAIL_DISCOVERY_BATCH_SIZE,
  GMAIL_DISCOVERY_FROM,
  GMAIL_DISCOVERY_TO,
  GMAIL_IMPORT_FILES_BUCKET,
  GMAIL_IMPORT_MAILBOX,
  GMAIL_MAX_FILE_BYTES,
} from "@/lib/gmail/config";
import {
  gmailRetryAfterSeconds,
  isGmailAuthFailure,
  isGmailRateLimit,
  sanitizeGmailError,
} from "@/lib/gmail/errors";
import { planOtherAttachment, planPdfDiscovery } from "@/lib/gmail/plan";
import { buildGmailDiscoveryQuery } from "@/lib/gmail/query";

type RunRow = {
  id: string;
  connection_id: string;
  status: string;
  date_from: string;
  date_to: string;
  page_token: string | null;
  query: string;
};

const DISCOVERY_LEASE_SECONDS = 120;

function safeMessage(error: unknown) {
  return sanitizeGmailError(error);
}

function rethrowIfDiscoveryMustStop(error: unknown): void {
  if (isGmailRateLimit(error) || isGmailAuthFailure(error)) {
    throw error;
  }
}

function checksumOf(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeFileName(filename: string) {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 80) || "attachment.pdf";
}

async function loadCatalog(admin: SupabaseClient) {
  const [{ data: suppliers, error: supplierError }, { data: aliases, error: aliasError }] =
    await Promise.all([
      admin.from("suppliers").select("id, name, normalized_name"),
      admin.from("supplier_aliases").select("supplier_id, alias, normalized_alias"),
    ]);

  if (supplierError || aliasError) {
    throw new Error("Suppliers could not be loaded for discovery.");
  }

  return {
    suppliers: (suppliers ?? []).map(
      (supplier): InvoiceSupplierRef => ({
        id: String(supplier.id),
        name: String(supplier.name),
        normalizedName: String(supplier.normalized_name),
      })
    ),
    aliases: (aliases ?? []).map(
      (alias): InvoiceAliasRef => ({
        supplierId: String(alias.supplier_id),
        alias: String(alias.alias),
        normalizedAlias: String(alias.normalized_alias),
      })
    ),
  };
}

async function refreshRunCounts(admin: SupabaseClient, runId: string) {
  const [{ count: messages }, { data: items, error }] = await Promise.all([
    admin
      .from("gmail_import_messages")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId),
    admin
      .from("gmail_import_items")
      .select("document_type, status, mime_type")
      .eq("run_id", runId),
  ]);

  if (error) {
    throw new Error("Discovery progress could not be saved.");
  }

  const rows = items ?? [];
  const count = (documentType: string, status?: string) =>
    rows.filter((row) => row.document_type === documentType && (!status || row.status === status))
      .length;

  await admin
    .from("gmail_import_runs")
    .update({
      messages_seen: messages ?? 0,
      attachments_seen: rows.length,
      pdfs_seen: rows.filter((row) => String(row.mime_type ?? "").includes("pdf")).length,
      images_seen: count("unsupported_image"),
      invoices_found: count("invoice"),
      credit_notes_found: count("credit_note"),
      sales_orders_found: count("sales_order"),
      delivery_notes_found: count("delivery_note"),
      unknown_found: rows.filter(
        (row) => row.document_type === "unknown" && row.status !== "skipped"
      ).length,
      duplicates_found: rows.filter((row) => row.status === "duplicate").length,
      failures: rows.filter((row) => row.status === "failed").length,
      skipped_found: rows.filter((row) => row.status === "skipped").length,
    })
    .eq("id", runId);
}

async function activeRun(admin: SupabaseClient) {
  const { data: connection } = await admin
    .from("gmail_connections")
    .select("id, status")
    .eq("mailbox", GMAIL_IMPORT_MAILBOX)
    .maybeSingle();

  if (!connection?.id || connection.status !== "connected") {
    throw new Error("Connect Gmail before starting discovery.");
  }

  const { data: run } = await admin
    .from("gmail_import_runs")
    .select("id, connection_id, status, date_from, date_to, page_token, query")
    .eq("connection_id", connection.id)
    .in("status", ["running", "paused"])
    .maybeSingle();

  return { connectionId: connection.id as string, run: (run as RunRow | null) ?? null };
}

export async function startGmailDiscovery(input: {
  admin: SupabaseClient;
  userId: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const { connectionId, run } = await activeRun(input.admin);

  if (run) {
    return { runId: run.id, status: run.status, alreadyActive: true };
  }

  const dateFrom = input.dateFrom || GMAIL_DISCOVERY_FROM;
  const dateTo = input.dateTo || GMAIL_DISCOVERY_TO;
  const query = buildGmailDiscoveryQuery(dateFrom, dateTo);
  const { data, error } = await input.admin
    .from("gmail_import_runs")
    .insert({
      connection_id: connectionId,
      kind: "discovery",
      status: "running",
      date_from: dateFrom,
      date_to: dateTo,
      query,
      started_at: new Date().toISOString(),
      created_by: input.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Discovery could not be started.");
  }

  return { runId: data.id as string, status: "running", alreadyActive: false };
}

export async function setGmailDiscoveryPaused(admin: SupabaseClient, paused: boolean) {
  const { run } = await activeRun(admin);

  if (!run) {
    throw new Error("There is no discovery to update.");
  }

  const { error } = await admin
    .from("gmail_import_runs")
    .update({
      status: paused ? "paused" : "running",
      paused_at: paused ? new Date().toISOString() : null,
      last_error: null,
    })
    .eq("id", run.id);

  if (error) {
    throw new Error("Discovery could not be updated.");
  }
}

async function insertItem(
  admin: SupabaseClient,
  row: Record<string, unknown>
) {
  const { data, error } = await admin.from("gmail_import_items").insert(row).select("id").single();

  if (error || !data) {
    throw new Error("A discovery record could not be saved.");
  }

  return data.id as string;
}

async function storePdf(input: {
  admin: SupabaseClient;
  itemId: string;
  bytes: Uint8Array;
  filename: string;
  checksum: string;
}) {
  const storagePath = `${input.itemId}/${input.checksum.slice(0, 16)}-${safeFileName(input.filename)}`;
  const { error: uploadError } = await input.admin.storage
    .from(GMAIL_IMPORT_FILES_BUCKET)
    .upload(storagePath, input.bytes, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    throw new Error("The PDF could not be stored.");
  }

  const { error } = await input.admin.from("gmail_import_files").insert({
    item_id: input.itemId,
    storage_path: storagePath,
    original_filename: input.filename,
    mime_type: "application/pdf",
    byte_size: input.bytes.byteLength,
    checksum_sha256: input.checksum,
  });

  if (error) {
    await input.admin.storage.from(GMAIL_IMPORT_FILES_BUCKET).remove([storagePath]);
    throw new Error("The PDF record could not be stored.");
  }
}

async function processPdf(input: {
  admin: SupabaseClient;
  run: RunRow;
  messageId: string;
  threadId: string;
  filename: string;
  attachmentId: string;
  bytes: Uint8Array;
  suppliers: readonly InvoiceSupplierRef[];
  aliases: readonly InvoiceAliasRef[];
}) {
  const { extractInvoiceDocument } = await import("@/lib/materials/invoices/extract");
  const checksum = checksumOf(input.bytes);
  const [{ data: manual }, { data: prior }] = await Promise.all([
    input.admin
      .from("supplier_invoice_files")
      .select("invoice_id")
      .eq("checksum_sha256", checksum)
      .maybeSingle(),
    input.admin
      .from("gmail_import_files")
      .select("item_id")
      .eq("checksum_sha256", checksum)
      .maybeSingle(),
  ]);
  const extracted = await extractInvoiceDocument({
    bytes: input.bytes,
    mimeType: "application/pdf",
  });
  const plan = planPdfDiscovery({
    text: extracted.text,
    extractFailed: extracted.extractionStatus === "failed",
    byteSize: input.bytes.byteLength,
    manualInvoiceId: (manual?.invoice_id as string | undefined) ?? null,
    existingDiscoveryItemId: (prior?.item_id as string | undefined) ?? null,
  });
  const parsed =
    extracted.text && (plan.documentType === "invoice" || plan.documentType === "credit_note")
      ? parseInvoiceText(extracted.text)
      : null;
  const supplier =
    extracted.text && plan.status === "stored"
      ? resolveInvoiceSupplier(null, extracted.text, input.suppliers, input.aliases)
      : null;
  const itemId = await insertItem(input.admin, {
    run_id: input.run.id,
    connection_id: input.run.connection_id,
    gmail_message_id: input.messageId,
    gmail_attachment_id: input.attachmentId,
    gmail_thread_id: input.threadId,
    filename: input.filename,
    mime_type: "application/pdf",
    byte_size: input.bytes.byteLength,
    checksum_sha256: checksum,
    document_type: plan.documentType,
    status: plan.status,
    supplier_id: supplier?.supplierId ?? null,
    supplier_note: supplier?.warning ?? supplier?.supplierName ?? null,
    invoice_number: parsed?.invoiceNumber ?? null,
    invoice_date: parsed?.invoiceDate ?? null,
    duplicate_invoice_id: plan.duplicateInvoiceId,
    duplicate_item_id: plan.duplicateItemId,
    detail: plan.detail,
    attempt_count: plan.status === "failed" ? 1 : 0,
  });

  if (plan.storeFile) {
    try {
      await storePdf({
        admin: input.admin,
        itemId,
        bytes: input.bytes,
        filename: input.filename,
        checksum,
      });
    } catch (error) {
      await input.admin
        .from("gmail_import_items")
        .update({ status: "failed", detail: safeMessage(error), attempt_count: 1 })
        .eq("id", itemId);
    }
  }
}

export async function stepGmailDiscovery(input: {
  admin: SupabaseClient;
  client?: GmailDiscoveryClient;
}) {
  const { run } = await activeRun(input.admin);

  if (!run) {
    throw new Error("There is no discovery to continue.");
  }

  if (run.status === "paused") {
    return { status: "paused" as const };
  }

  const { data: claimed, error: claimError } = await input.admin.rpc("claim_gmail_discovery_run", {
    target_id: run.id,
    lease_seconds: DISCOVERY_LEASE_SECONDS,
  });

  if (claimError) {
    throw new Error("Discovery could not be locked.");
  }

  if (claimed !== true) {
    return { status: "running" as const, busy: true };
  }

  try {
    const client =
      input.client ??
      createGmailApiClient(await refreshStoredGmailAccessToken(input.admin, run.connection_id));
    const page = await client.listMessages({
      query: run.query,
      pageToken: run.page_token,
      maxResults: GMAIL_DISCOVERY_BATCH_SIZE,
    });
    const catalog = await loadCatalog(input.admin);

    for (const message of page.messages) {
      const { data: seen } = await input.admin
        .from("gmail_import_messages")
        .select("id")
        .eq("run_id", run.id)
        .eq("gmail_message_id", message.id)
        .maybeSingle();

      if (seen) {
        continue;
      }

      const full = await client.getMessage(message.id);

      for (const attachment of collectAttachments(full.payload)) {
        const { data: existingItem } = await input.admin
          .from("gmail_import_items")
          .select("id, status")
          .eq("gmail_message_id", message.id)
          .eq("gmail_attachment_id", attachment.attachmentId)
          .maybeSingle();

        if (existingItem) {
          if (existingItem.status === "stored" && attachment.kind === "pdf") {
            const { data: storedFile } = await input.admin
              .from("gmail_import_files")
              .select("id")
              .eq("item_id", existingItem.id)
              .maybeSingle();

            if (!storedFile) {
              try {
                const bytes = await client.getAttachment(message.id, attachment.attachmentId);
                await storePdf({
                  admin: input.admin,
                  itemId: String(existingItem.id),
                  bytes,
                  filename: attachment.filename,
                  checksum: checksumOf(bytes),
                });
              } catch (error) {
                rethrowIfDiscoveryMustStop(error);
                await input.admin
                  .from("gmail_import_items")
                  .update({ status: "failed", detail: safeMessage(error), attempt_count: 1 })
                  .eq("id", existingItem.id);
              }
            }
          }

          continue;
        }

        if (attachment.kind === "pdf" && attachment.size > GMAIL_MAX_FILE_BYTES) {
          await insertItem(input.admin, {
            run_id: run.id,
            connection_id: run.connection_id,
            gmail_message_id: message.id,
            gmail_attachment_id: attachment.attachmentId,
            gmail_thread_id: full.threadId,
            filename: attachment.filename,
            mime_type: attachment.mimeType,
            byte_size: attachment.size,
            document_type: "unknown",
            status: "failed",
            detail: "The attachment is larger than 15 MB.",
            attempt_count: 1,
          });
          continue;
        }

        if (attachment.kind !== "pdf") {
          const planned = planOtherAttachment(attachment.kind, attachment.size);
          await insertItem(input.admin, {
            run_id: run.id,
            connection_id: run.connection_id,
            gmail_message_id: message.id,
            gmail_attachment_id: attachment.attachmentId,
            gmail_thread_id: full.threadId,
            filename: attachment.filename,
            mime_type: attachment.mimeType,
            byte_size: attachment.size,
            document_type: planned.documentType,
            status: planned.status,
            detail: planned.detail,
          });
          continue;
        }

        try {
          const bytes = await client.getAttachment(message.id, attachment.attachmentId);
          await processPdf({
            admin: input.admin,
            run,
            messageId: message.id,
            threadId: full.threadId,
            filename: attachment.filename,
            attachmentId: attachment.attachmentId,
            bytes,
            suppliers: catalog.suppliers,
            aliases: catalog.aliases,
          });
        } catch (error) {
          rethrowIfDiscoveryMustStop(error);
          await insertItem(input.admin, {
            run_id: run.id,
            connection_id: run.connection_id,
            gmail_message_id: message.id,
            gmail_attachment_id: attachment.attachmentId,
            gmail_thread_id: full.threadId,
            filename: attachment.filename,
            mime_type: attachment.mimeType,
            byte_size: attachment.size,
            document_type: "unknown",
            status: "failed",
            detail: safeMessage(error),
            attempt_count: 1,
          });
        }
      }

      await input.admin.from("gmail_import_messages").insert({
        run_id: run.id,
        gmail_message_id: message.id,
      });
    }

    const finished = !page.nextPageToken;
    const progress = {
      page_token: page.nextPageToken,
      finished_at: finished ? new Date().toISOString() : null,
      last_error: null,
      lease_until: null,
    };
    const { data: saved } = await input.admin
      .from("gmail_import_runs")
      .update({
        ...progress,
        status: finished ? "completed" : "running",
      })
      .eq("id", run.id)
      .eq("status", "running")
      .select("id");

    if (!saved || saved.length === 0) {
      await input.admin
        .from("gmail_import_runs")
        .update({
          ...progress,
          status: finished ? "completed" : "paused",
        })
        .eq("id", run.id);
      return { status: finished ? ("completed" as const) : ("paused" as const) };
    }

    await refreshRunCounts(input.admin, run.id);
    await input.admin
      .from("gmail_connections")
      .update({ last_success_at: new Date().toISOString(), last_error: null, status: "connected" })
      .eq("id", run.connection_id);

    return { status: finished ? ("completed" as const) : ("running" as const) };
  } catch (error) {
    const message = safeMessage(error);
    await input.admin
      .from("gmail_import_runs")
      .update({ last_error: message, lease_until: null })
      .eq("id", run.id);

    if (isGmailRateLimit(error)) {
      return {
        status: "running" as const,
        rateLimited: true,
        retryAfterSeconds: gmailRetryAfterSeconds(error),
      };
    }

    if (isGmailAuthFailure(error)) {
      await input.admin
        .from("gmail_connections")
        .update({ status: "error", last_error: "Gmail authorization failed." })
        .eq("id", run.connection_id);
    }

    throw new Error(message);
  }
}

export async function retryFailedGmailItems(admin: SupabaseClient) {
  const { data: connection } = await admin
    .from("gmail_connections")
    .select("id, status")
    .eq("mailbox", GMAIL_IMPORT_MAILBOX)
    .maybeSingle();

  if (!connection?.id || connection.status !== "connected") {
    throw new Error("Connect Gmail before retrying discovery.");
  }

  const { data: latest } = await admin
    .from("gmail_import_runs")
    .select("id, connection_id, status, date_from, date_to, page_token, query")
    .eq("connection_id", connection.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const run = (latest as RunRow | null) ?? null;

  if (!run) {
    throw new Error("There is no discovery with failures to retry.");
  }

  const { data: failed, error } = await admin
    .from("gmail_import_items")
    .select("id, gmail_message_id, gmail_attachment_id, filename, attempt_count")
    .eq("run_id", run.id)
    .eq("status", "failed")
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    throw new Error("Failed discovery records could not be loaded.");
  }

  if (!failed || failed.length === 0) {
    return { retried: 0 };
  }

  const client = createGmailApiClient(
    await refreshStoredGmailAccessToken(admin, run.connection_id)
  );
  const catalog = await loadCatalog(admin);
  let retried = 0;

  for (const item of failed) {
    try {
      const bytes = await client.getAttachment(
        String(item.gmail_message_id),
        String(item.gmail_attachment_id)
      );
      const { data: storedFile } = await admin
        .from("gmail_import_files")
        .select("storage_path")
        .eq("item_id", item.id)
        .maybeSingle();

      if (storedFile?.storage_path) {
        await admin.storage.from(GMAIL_IMPORT_FILES_BUCKET).remove([String(storedFile.storage_path)]);
      }

      await admin.from("gmail_import_items").delete().eq("id", item.id);

      try {
        await processPdf({
          admin,
          run,
          messageId: String(item.gmail_message_id),
          threadId: String(item.gmail_message_id),
          filename: String(item.filename),
          attachmentId: String(item.gmail_attachment_id),
          bytes,
          suppliers: catalog.suppliers,
          aliases: catalog.aliases,
        });
        retried += 1;
      } catch (error) {
        rethrowIfDiscoveryMustStop(error);
        await insertItem(admin, {
          run_id: run.id,
          connection_id: run.connection_id,
          gmail_message_id: item.gmail_message_id,
          gmail_attachment_id: item.gmail_attachment_id,
          filename: item.filename,
          mime_type: "application/pdf",
          document_type: "unknown",
          status: "failed",
          detail: safeMessage(error),
          attempt_count: Number(item.attempt_count ?? 0) + 1,
        });
      }
      continue;
    } catch (error) {
      rethrowIfDiscoveryMustStop(error);
      await admin
        .from("gmail_import_items")
        .update({
          status: "failed",
          detail: safeMessage(error),
          attempt_count: Number(item.attempt_count ?? 0) + 1,
        })
        .eq("id", item.id);
    }
  }

  await refreshRunCounts(admin, run.id);
  return { retried };
}
