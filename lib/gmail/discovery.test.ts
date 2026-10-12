import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { GmailDiscoveryClient } from "@/lib/gmail/client";
import { saveGmailConnection } from "@/lib/gmail/connection";
import { runGmailDiscoveryCron } from "@/lib/gmail/cron";
import {
  setGmailDiscoveryPaused,
  startGmailDiscovery,
  stepGmailDiscovery,
} from "@/lib/gmail/discovery";

type Row = Record<string, unknown>;

const FORBIDDEN = new Set([
  "supplier_invoices",
  "material_prices",
  "materials",
  "supplier_products",
]);

function createMemoryAdmin() {
  const tables: Record<string, Row[]> = {
    gmail_connections: [
      {
        id: "conn-1",
        mailbox: "accounts@candidcreative.uk",
        status: "connected",
      },
    ],
    gmail_connection_secrets: [],
    gmail_import_runs: [],
    gmail_import_messages: [],
    gmail_import_items: [],
    gmail_import_files: [],
    supplier_invoice_files: [],
    suppliers: [],
    supplier_aliases: [],
    gmail_sync_checkpoints: [],
  };
  const writes: string[] = [];
  let ids = 0;

  function from(table: string) {
    if (FORBIDDEN.has(table)) {
      throw new Error(`Unexpected access to ${table}`);
    }

    const filters: Array<(row: Row) => boolean> = [];
    let operation: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | null = null;
    let countExact = false;
    let limitCount = Number.POSITIVE_INFINITY;

    const api = {
      select(_columns?: string, options?: { count?: string }) {
        if (options?.count === "exact") {
          countExact = true;
        }
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return api;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return api;
      },
      order() {
        return api;
      },
      limit(count: number) {
        limitCount = count;
        return api;
      },
      insert(row: Row) {
        writes.push(`insert ${table}`);
        operation = "insert";
        ids += 1;
        payload = {
          id: `${table}-${ids}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...row,
        };
        tables[table].push(payload);
        return api;
      },
      update(patch: Row) {
        writes.push(`update ${table}`);
        operation = "update";
        payload = patch;
        return api;
      },
      delete() {
        writes.push(`delete ${table}`);
        operation = "delete";
        return api;
      },
      upsert(row: Row) {
        writes.push(`upsert ${table}`);
        const key = "connection_id" in row ? "connection_id" : "id";
        const existing = tables[table].find((item) => item[key] === row[key]);
        if (existing) {
          Object.assign(existing, row, { updated_at: new Date().toISOString() });
          payload = existing;
        } else {
          payload = { ...row, updated_at: new Date().toISOString() };
          tables[table].push(payload);
        }
        operation = "insert";
        return api;
      },
      maybeSingle: async () => one(),
      single: async () => one(),
      then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };

    function matching() {
      return tables[table].filter((row) => filters.every((filter) => filter(row))).slice(0, limitCount);
    }

    function execute() {
      if (operation === "update") {
        const matched = matching();
        for (const row of matched) {
          Object.assign(row, payload, { updated_at: new Date().toISOString() });
        }
        return { data: matched, error: null, count: matched.length };
      }

      if (operation === "delete") {
        const matched = matching();
        tables[table] = tables[table].filter((row) => !matched.includes(row));
        return { data: matched, error: null };
      }

      if (operation === "insert") {
        return { data: payload, error: null };
      }

      const matched = matching();
      return {
        data: countExact ? null : matched,
        error: null,
        count: matched.length,
      };
    }

    function one() {
      const result = execute();
      const row = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
      return { data: row, error: null };
    }

    return api;
  }

  return {
    admin: {
      from,
      async rpc(name: string, args: { target_id: string }) {
        if (name !== "claim_gmail_discovery_run") {
          return { data: null, error: { message: "Unknown discovery function." } };
        }

        const run = tables.gmail_import_runs.find(
          (item) => item.id === args.target_id && item.status === "running"
        );
        const now = new Date().toISOString();
        if (!run || (typeof run.lease_until === "string" && run.lease_until > now)) {
          return { data: false, error: null };
        }

        run.lease_until = new Date(Date.now() + 120_000).toISOString();
        run.updated_at = now;
        return { data: true, error: null };
      },
      storage: {
        from() {
          return {
            async upload() {
              writes.push("upload gmail-import-files");
              return { error: null };
            },
            async remove() {
              return { error: null };
            },
          };
        },
      },
    } as unknown as SupabaseClient,
    tables,
    writes,
  };
}

test("rejects a Google account that is not the accounts mailbox", async () => {
  await assert.rejects(
    saveGmailConnection({
      admin: {} as SupabaseClient,
      userId: "user-1",
      refreshToken: "refresh-token",
      googleEmail: "daniel@candidcreative.uk",
      historyId: null,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    }),
    /accounts@candidcreative.uk/
  );
});

test("does not start a second discovery while one is active", async () => {
  const memory = createMemoryAdmin();
  const first = await startGmailDiscovery({ admin: memory.admin, userId: "user-1" });
  const second = await startGmailDiscovery({ admin: memory.admin, userId: "user-1" });

  assert.equal(first.alreadyActive, false);
  assert.equal(second.alreadyActive, true);
  assert.equal(second.runId, first.runId);
  assert.equal(memory.tables.gmail_import_runs.length, 1);
  assert.equal(memory.writes.some((write) => write.includes("supplier_invoices")), false);
});

test("a paused discovery does not read Gmail until it is resumed", async () => {
  const memory = createMemoryAdmin();
  await startGmailDiscovery({ admin: memory.admin, userId: "user-1" });
  let reads = 0;
  const client: GmailDiscoveryClient = {
    async listMessages() {
      reads += 1;
      return { messages: [], nextPageToken: null };
    },
    async getMessage(messageId) {
      return { id: messageId, threadId: messageId, payload: {} };
    },
    async getAttachment() {
      return new Uint8Array();
    },
  };

  await setGmailDiscoveryPaused(memory.admin, true);
  const paused = await stepGmailDiscovery({ admin: memory.admin, client });
  assert.equal(paused.status, "paused");
  assert.equal(reads, 0);

  await setGmailDiscoveryPaused(memory.admin, false);
  const resumed = await stepGmailDiscovery({ admin: memory.admin, client });
  assert.equal(resumed.status, "completed");
  assert.equal(reads, 1);
});

test("an overlapping discovery step does not read Gmail twice", async () => {
  const memory = createMemoryAdmin();
  await startGmailDiscovery({ admin: memory.admin, userId: "user-1" });
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const enteredGate = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let reads = 0;
  const client: GmailDiscoveryClient = {
    async listMessages() {
      reads += 1;
      entered();
      await gate;
      return { messages: [], nextPageToken: null };
    },
    async getMessage(messageId) {
      return { id: messageId, threadId: messageId, payload: {} };
    },
    async getAttachment() {
      return new Uint8Array();
    },
  };

  const first = stepGmailDiscovery({ admin: memory.admin, client });
  await enteredGate;
  const second = await stepGmailDiscovery({ admin: memory.admin, client });
  assert.equal(second.busy, true);
  assert.equal(reads, 1);
  release();
  assert.equal((await first).status, "completed");
});

test("an interrupted batch resumes without discovering the same attachment twice", async () => {
  const memory = createMemoryAdmin();
  await startGmailDiscovery({ admin: memory.admin, userId: "user-1" });
  let failSecond = true;
  const client: GmailDiscoveryClient = {
    async listMessages({ pageToken }) {
      if (pageToken === "page-2") {
        return { messages: [{ id: "message-2", threadId: "message-2" }], nextPageToken: null };
      }
      return {
        messages: [
          { id: "message-1", threadId: "message-1" },
          { id: "message-2", threadId: "message-2" },
        ],
        nextPageToken: "page-2",
      };
    },
    async getMessage(messageId) {
      if (messageId === "message-2" && failSecond) {
        throw new Error("The function stopped.");
      }
      return {
        id: messageId,
        threadId: messageId,
        payload: {
          filename: `${messageId}.jpg`,
          mimeType: "image/jpeg",
          body: { attachmentId: `attachment-${messageId}`, size: 12 },
        },
      };
    },
    async getAttachment() {
      return new Uint8Array([1]);
    },
  };

  await assert.rejects(stepGmailDiscovery({ admin: memory.admin, client }));
  assert.equal(memory.tables.gmail_import_runs[0]?.page_token ?? null, null);
  assert.equal(memory.tables.gmail_import_items.length, 1);
  assert.equal(memory.tables.gmail_import_messages.length, 1);

  failSecond = false;
  const resumed = await stepGmailDiscovery({ admin: memory.admin, client });
  assert.equal(resumed.status, "running");
  assert.equal(memory.tables.gmail_import_runs[0]?.page_token, "page-2");
  assert.equal(memory.tables.gmail_import_items.length, 2);

  const finished = await stepGmailDiscovery({ admin: memory.admin, client });
  assert.equal(finished.status, "completed");
  assert.equal(memory.tables.gmail_import_items.length, 2);
  assert.equal(
    memory.writes.filter((write) => write === "insert gmail_import_items").length,
    2
  );
});

test("stops a rate-limited batch without losing its place", async () => {
  const memory = createMemoryAdmin();
  await startGmailDiscovery({ admin: memory.admin, userId: "user-1" });
  const client: GmailDiscoveryClient = {
    async listMessages() {
      const error = new Error("Gmail rate limit") as Error & { status?: number; retryAfterSeconds?: number };
      error.status = 429;
      error.retryAfterSeconds = 9;
      throw error;
    },
    async getMessage(messageId) {
      return { id: messageId, threadId: messageId, payload: {} };
    },
    async getAttachment() {
      return new Uint8Array();
    },
  };

  const result = await stepGmailDiscovery({ admin: memory.admin, client });
  assert.equal(result.rateLimited, true);
  assert.equal(result.retryAfterSeconds, 9);
  assert.equal(memory.tables.gmail_import_runs[0]?.status, "running");
  assert.equal(memory.tables.gmail_import_runs[0]?.page_token ?? null, null);
  assert.equal(memory.tables.gmail_import_items.length, 0);
  assert.equal(memory.tables.gmail_connections[0]?.status, "connected");
});

test("marks the connection when the refresh grant has been revoked", async () => {
  const memory = createMemoryAdmin();
  await startGmailDiscovery({ admin: memory.admin, userId: "user-1" });
  const client: GmailDiscoveryClient = {
    async listMessages() {
      const error = new Error("Token has been expired or revoked.") as Error & { code?: string; status?: number };
      error.code = "invalid_grant";
      error.status = 400;
      throw error;
    },
    async getMessage(messageId) {
      return { id: messageId, threadId: messageId, payload: {} };
    },
    async getAttachment() {
      return new Uint8Array();
    },
  };

  await assert.rejects(stepGmailDiscovery({ admin: memory.admin, client }), /expired or revoked/);
  assert.equal(memory.tables.gmail_connections[0]?.status, "error");
  assert.equal(memory.tables.gmail_import_runs[0]?.page_token ?? null, null);
  assert.equal(memory.tables.gmail_import_items.length, 0);
});

test("matches a repeated PDF to a manual upload and does not create invoice records", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 45]);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const memory = createMemoryAdmin();
  memory.tables.supplier_invoice_files.push({
    invoice_id: "manual-invoice-1",
    checksum_sha256: checksum,
  });
  await startGmailDiscovery({ admin: memory.admin, userId: "user-1" });
  const client: GmailDiscoveryClient = {
    async listMessages() {
      return {
        messages: [
          { id: "message-1", threadId: "message-1" },
          { id: "message-2", threadId: "message-2" },
        ],
        nextPageToken: null,
      };
    },
    async getMessage(messageId) {
      return {
        id: messageId,
        threadId: messageId,
        payload: {
          filename: `${messageId}.pdf`,
          mimeType: "application/pdf",
          body: { attachmentId: `attachment-${messageId}`, size: bytes.byteLength },
        },
      };
    },
    async getAttachment() {
      return bytes;
    },
  };

  const result = await stepGmailDiscovery({ admin: memory.admin, client });
  assert.equal(result.status, "completed");
  assert.equal(memory.tables.gmail_import_items.length, 2);
  assert.equal(
    memory.tables.gmail_import_items.every(
      (item) => item.status === "duplicate" && item.duplicate_invoice_id === "manual-invoice-1"
    ),
    true
  );
  assert.equal(memory.tables.gmail_import_files.length, 0);
  assert.equal(memory.writes.some((write) => FORBIDDEN.has(write.split(" ")[1] ?? "")), false);
});

test("cron completes a backfill once and does not start a second run", async () => {
  const memory = createMemoryAdmin();
  memory.tables.gmail_sync_checkpoints.push({
    connection_id: "conn-1",
    enabled: true,
    overlap_minutes: 180,
    scanned_through: null,
  });
  await startGmailDiscovery({ admin: memory.admin, userId: "user-1" });
  const client: GmailDiscoveryClient = {
    async listMessages() {
      return { messages: [], nextPageToken: null };
    },
    async getMessage(messageId) {
      return { id: messageId, threadId: messageId, payload: {} };
    },
    async getAttachment() {
      return new Uint8Array();
    },
  };

  const first = await runGmailDiscoveryCron({
    admin: memory.admin,
    client,
    maxBatches: 3,
    budgetMs: 5_000,
  });
  const second = await runGmailDiscoveryCron({
    admin: memory.admin,
    client,
    maxBatches: 3,
    budgetMs: 5_000,
  });

  assert.equal(first.status, "completed");
  assert.equal(first.ongoing.action, "skip");
  assert.equal(second.status, "idle");
  assert.equal(memory.tables.gmail_import_runs.length, 1);
  assert.equal(memory.writes.some((write) => FORBIDDEN.has(write.split(" ")[1] ?? "")), false);
});

test("cron recovers after a discovery lease expires", async () => {
  const memory = createMemoryAdmin();
  await startGmailDiscovery({ admin: memory.admin, userId: "user-1" });
  memory.tables.gmail_import_runs[0].lease_until = new Date(Date.now() + 60_000).toISOString();
  let reads = 0;
  const client: GmailDiscoveryClient = {
    async listMessages() {
      reads += 1;
      return { messages: [], nextPageToken: null };
    },
    async getMessage(messageId) {
      return { id: messageId, threadId: messageId, payload: {} };
    },
    async getAttachment() {
      return new Uint8Array();
    },
  };

  const held = await runGmailDiscoveryCron({ admin: memory.admin, client, maxBatches: 2, budgetMs: 5_000 });
  assert.equal(held.status, "running");
  assert.equal(reads, 0);

  memory.tables.gmail_import_runs[0].lease_until = new Date(Date.now() - 1_000).toISOString();
  const recovered = await runGmailDiscoveryCron({
    admin: memory.admin,
    client,
    maxBatches: 2,
    budgetMs: 5_000,
  });
  assert.equal(recovered.status, "completed");
  assert.equal(reads, 1);
});
