import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptGmailRefreshToken, encryptGmailRefreshToken } from "@/lib/gmail/crypto";
import { GMAIL_IMPORT_MAILBOX, GMAIL_READONLY_SCOPE, missingGmailEnv } from "@/lib/gmail/config";
import { sanitizeGmailError } from "@/lib/gmail/errors";
import {
  fetchGmailProfile,
  gmailScopeIsReadOnly,
  refreshGmailAccessToken,
  revokeGmailToken,
} from "@/lib/gmail/oauth";

export type GmailConnectionView = {
  id: string | null;
  mailbox: string;
  status: "not_connected" | "connected" | "error" | "revoked" | "disconnected";
  googleEmail: string | null;
  connectedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  credentialsConfigured: boolean;
  missingEnv: string[];
};

export type GmailRunView = {
  id: string;
  status: "running" | "paused" | "completed" | "failed";
  dateFrom: string;
  dateTo: string;
  query: string;
  messagesSeen: number;
  attachmentsSeen: number;
  pdfsSeen: number;
  imagesSeen: number;
  invoicesFound: number;
  creditNotesFound: number;
  salesOrdersFound: number;
  deliveryNotesFound: number;
  unknownFound: number;
  duplicatesFound: number;
  failures: number;
  skippedFound: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  pausedAt: string | null;
  updatedAt: string | null;
};

export type GmailItemView = {
  id: string;
  filename: string;
  documentType: string;
  status: string;
  supplierNote: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  detail: string | null;
  attemptCount: number;
};

type ConnectionRow = {
  id: string;
  mailbox: string;
  status: GmailConnectionView["status"];
  google_email: string | null;
  connected_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
};

function emptyConnection(): GmailConnectionView {
  const missingEnv = missingGmailEnv();

  return {
    id: null,
    mailbox: GMAIL_IMPORT_MAILBOX,
    status: "not_connected",
    googleEmail: null,
    connectedAt: null,
    lastSuccessAt: null,
    lastError: null,
    credentialsConfigured: missingEnv.length === 0,
    missingEnv,
  };
}

function mapRun(row: Record<string, unknown>): GmailRunView {
  return {
    id: String(row.id),
    status: row.status as GmailRunView["status"],
    dateFrom: String(row.date_from),
    dateTo: String(row.date_to),
    query: String(row.query),
    messagesSeen: Number(row.messages_seen ?? 0),
    attachmentsSeen: Number(row.attachments_seen ?? 0),
    pdfsSeen: Number(row.pdfs_seen ?? 0),
    imagesSeen: Number(row.images_seen ?? 0),
    invoicesFound: Number(row.invoices_found ?? 0),
    creditNotesFound: Number(row.credit_notes_found ?? 0),
    salesOrdersFound: Number(row.sales_orders_found ?? 0),
    deliveryNotesFound: Number(row.delivery_notes_found ?? 0),
    unknownFound: Number(row.unknown_found ?? 0),
    duplicatesFound: Number(row.duplicates_found ?? 0),
    failures: Number(row.failures ?? 0),
    skippedFound: Number(row.skipped_found ?? 0),
    lastError: (row.last_error as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    pausedAt: (row.paused_at as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

export async function loadGmailImportView(admin: SupabaseClient) {
  const missingEnv = missingGmailEnv();
  const { data: connection, error } = await admin
    .from("gmail_connections")
    .select("id, mailbox, status, google_email, connected_at, last_success_at, last_error")
    .eq("mailbox", GMAIL_IMPORT_MAILBOX)
    .maybeSingle();

  if (error) {
    throw new Error("The Gmail connection could not be loaded.");
  }

  const view: GmailConnectionView = connection
    ? {
        id: (connection as ConnectionRow).id,
        mailbox: (connection as ConnectionRow).mailbox,
        status: (connection as ConnectionRow).status,
        googleEmail: (connection as ConnectionRow).google_email,
        connectedAt: (connection as ConnectionRow).connected_at,
        lastSuccessAt: (connection as ConnectionRow).last_success_at,
        lastError: (connection as ConnectionRow).last_error,
        credentialsConfigured: missingEnv.length === 0,
        missingEnv,
      }
    : emptyConnection();

  if (!view.id) {
    return { connection: view, run: null as GmailRunView | null, items: [] as GmailItemView[] };
  }

  const { data: run } = await admin
    .from("gmail_import_runs")
    .select(
      "id, status, date_from, date_to, query, messages_seen, attachments_seen, pdfs_seen, images_seen, invoices_found, credit_notes_found, sales_orders_found, delivery_notes_found, unknown_found, duplicates_found, failures, skipped_found, last_error, started_at, finished_at, paused_at, updated_at"
    )
    .eq("connection_id", view.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const runView = run ? mapRun(run as Record<string, unknown>) : null;
  const { data: items } = runView
    ? await admin
        .from("gmail_import_items")
        .select(
          "id, filename, document_type, status, supplier_note, invoice_number, invoice_date, detail, attempt_count"
        )
        .eq("run_id", runView.id)
        .order("created_at", { ascending: false })
        .limit(40)
    : { data: [] };

  return {
    connection: view,
    run: runView,
    items: (items ?? []).map(
      (item): GmailItemView => ({
        id: String(item.id),
        filename: String(item.filename),
        documentType: String(item.document_type),
        status: String(item.status),
        supplierNote: (item.supplier_note as string | null) ?? null,
        invoiceNumber: (item.invoice_number as string | null) ?? null,
        invoiceDate: (item.invoice_date as string | null) ?? null,
        detail: (item.detail as string | null) ?? null,
        attemptCount: Number(item.attempt_count ?? 0),
      })
    ),
  };
}

export async function saveGmailConnection(input: {
  admin: SupabaseClient;
  userId: string;
  refreshToken: string;
  googleEmail: string;
  historyId: string | null;
  scope: string;
}) {
  if (input.googleEmail !== GMAIL_IMPORT_MAILBOX) {
    throw new Error(`Connect ${GMAIL_IMPORT_MAILBOX}. This account was ${input.googleEmail}.`);
  }

  if (!gmailScopeIsReadOnly(input.scope)) {
    throw new Error("Gmail did not grant read-only access.");
  }

  const ciphertext = encryptGmailRefreshToken(input.refreshToken);
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await input.admin
    .from("gmail_connections")
    .select("id")
    .eq("mailbox", GMAIL_IMPORT_MAILBOX)
    .maybeSingle();

  if (existingError) {
    throw new Error("The Gmail connection could not be saved.");
  }

  const payload = {
    mailbox: GMAIL_IMPORT_MAILBOX,
    status: "connected",
    scopes: GMAIL_READONLY_SCOPE,
    google_email: input.googleEmail,
    connected_by: input.userId,
    connected_at: now,
    revoked_at: null,
    last_success_at: now,
    last_error: null,
    history_id: input.historyId,
  };
  let connectionId = existing?.id as string | undefined;
  let previousToken: string | null = null;

  if (connectionId) {
    try {
      previousToken = await loadGmailRefreshToken(input.admin, connectionId);
    } catch {
      previousToken = null;
    }
  }

  if (connectionId) {
    const { error } = await input.admin.from("gmail_connections").update(payload).eq("id", connectionId);

    if (error) {
      throw new Error("The Gmail connection could not be saved.");
    }
  } else {
    const { data, error } = await input.admin
      .from("gmail_connections")
      .insert(payload)
      .select("id")
      .single();

    if (error || !data) {
      throw new Error("The Gmail connection could not be saved.");
    }

    connectionId = data.id as string;
  }

  const { error: secretError } = await input.admin.from("gmail_connection_secrets").upsert({
    connection_id: connectionId,
    refresh_token_ciphertext: ciphertext,
    updated_at: now,
  });

  if (secretError) {
    throw new Error("The Gmail token could not be stored.");
  }

  if (previousToken && previousToken !== input.refreshToken) {
    try {
      await revokeGmailToken(previousToken);
    } catch {
      // The new token is already stored. An old token that Google has expired can fail revocation.
    }
  }

  return connectionId as string;
}

export async function refreshStoredGmailAccessToken(admin: SupabaseClient, connectionId: string) {
  const refreshToken = await loadGmailRefreshToken(admin, connectionId);
  const refreshed = await refreshGmailAccessToken(refreshToken);

  if (refreshed.refreshToken && refreshed.refreshToken !== refreshToken) {
    const { error } = await admin.from("gmail_connection_secrets").upsert({
      connection_id: connectionId,
      refresh_token_ciphertext: encryptGmailRefreshToken(refreshed.refreshToken),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error("The rotated Gmail token could not be stored.");
    }
  }

  return refreshed.accessToken;
}

export async function loadGmailRefreshToken(admin: SupabaseClient, connectionId: string) {
  const { data, error } = await admin
    .from("gmail_connection_secrets")
    .select("refresh_token_ciphertext")
    .eq("connection_id", connectionId)
    .maybeSingle();

  if (error || !data?.refresh_token_ciphertext) {
    throw new Error("Gmail is not connected.");
  }

  return decryptGmailRefreshToken(String(data.refresh_token_ciphertext));
}

export async function disconnectGmail(admin: SupabaseClient) {
  const { data: connection } = await admin
    .from("gmail_connections")
    .select("id")
    .eq("mailbox", GMAIL_IMPORT_MAILBOX)
    .maybeSingle();

  if (!connection?.id) {
    return;
  }

  try {
    const refreshToken = await loadGmailRefreshToken(admin, connection.id);
    await revokeGmailToken(refreshToken);
  } catch {
    // Local disconnect still proceeds when Google revocation is already complete.
  }

  await admin.from("gmail_connection_secrets").delete().eq("connection_id", connection.id);
  await admin
    .from("gmail_connections")
    .update({
      status: "revoked",
      revoked_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", connection.id);
}

export async function checkGmailConnection(admin: SupabaseClient) {
  const { data: connection } = await admin
    .from("gmail_connections")
    .select("id")
    .eq("mailbox", GMAIL_IMPORT_MAILBOX)
    .eq("status", "connected")
    .maybeSingle();

  if (!connection?.id) {
    throw new Error("Gmail is not connected.");
  }

  try {
    const accessToken = await refreshStoredGmailAccessToken(admin, connection.id);
    const profile = await fetchGmailProfile(accessToken);

    if (profile.email !== GMAIL_IMPORT_MAILBOX) {
      throw new Error(`The connected mailbox is ${profile.email}.`);
    }

    await admin
      .from("gmail_connections")
      .update({
        status: "connected",
        last_success_at: new Date().toISOString(),
        last_error: null,
        history_id: profile.historyId,
        google_email: profile.email,
      })
      .eq("id", connection.id);
  } catch (error) {
    const message = sanitizeGmailError(error);
    await admin
      .from("gmail_connections")
      .update({ status: "error", last_error: message })
      .eq("id", connection.id);
    throw new Error(message);
  }
}
