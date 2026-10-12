import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { GMAIL_ONGOING_SYNC_ENABLED } from "@/lib/gmail/config";
import { handleGmailDiscoveryCron } from "@/lib/gmail/cron-http";

const FORBIDDEN = ["supplier_invoices", "material_prices", "materials", "supplier_products"];

function request(authorization?: string) {
  return new Request("https://os.candidcreative.uk/api/cron/gmail-discovery", {
    headers: authorization ? { authorization } : {},
  });
}

function emptyAdmin() {
  const tables: string[] = [];

  return {
    tables,
    admin: {
      from(table: string) {
        if (FORBIDDEN.includes(table)) {
          throw new Error(`Unexpected access to ${table}`);
        }

        tables.push(table);
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          in() {
            return api;
          },
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return api;
      },
    } as unknown as SupabaseClient,
  };
}

test("missing CRON_SECRET does not load discovery", async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  let loaded = false;

  try {
    const response = await handleGmailDiscoveryCron(request("Bearer secret"), async () => {
      loaded = true;
      throw new Error("Discovery was loaded.");
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "CRON_SECRET is not configured." });
    assert.equal(loaded, false);
  } finally {
    if (previous === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previous;
    }
  }
});

test("an invalid bearer token does not load discovery", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "cron-secret";
  let loaded = false;

  try {
    const response = await handleGmailDiscoveryCron(request("Bearer wrong-secret"), async () => {
      loaded = true;
      throw new Error("Discovery was loaded.");
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized." });
    assert.equal(loaded, false);
  } finally {
    if (previous === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previous;
    }
  }
});

test("a valid bearer token with no discovery run stays idle", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "cron-secret";

  try {
    const { runGmailDiscoveryCron } = await import("@/lib/gmail/cron");
    const memory = emptyAdmin();
    const response = await handleGmailDiscoveryCron(request("Bearer cron-secret"), async () => ({
      run: () => runGmailDiscoveryCron({ admin: memory.admin }),
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "idle");
    assert.equal(body.ok, true);
    assert.equal(body.needsAttention, false);
    assert.equal(body.batches, 0);
    assert.equal(body.ongoing.action, "skip");
    assert.equal(body.ongoing.reason, "disabled");
    assert.equal(GMAIL_ONGOING_SYNC_ENABLED, false);
    assert.equal(memory.tables.some((table) => FORBIDDEN.includes(table)), false);
    const loaded = (
      (process as NodeJS.Process & { moduleLoadList?: string[] }).moduleLoadList ?? []
    ).join("\n");
    assert.doesNotMatch(loaded, /pdfjs-dist/);
  } finally {
    if (previous === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previous;
    }
  }
});

test("the cron route authenticates before loading the discovery worker", async () => {
  const route = await readFile(
    new URL("../../app/api/cron/gmail-discovery/route.ts", import.meta.url),
    "utf8"
  );
  const handler = await readFile(new URL("./cron-http.ts", import.meta.url), "utf8");
  const extract = await readFile(
    new URL("../materials/invoices/extract.ts", import.meta.url),
    "utf8"
  );
  const discovery = await readFile(new URL("./discovery.ts", import.meta.url), "utf8");

  assert.match(route, /export const runtime = "nodejs"/);
  assert.doesNotMatch(route, /pdfjs-dist|@\/lib\/gmail\/cron"|@\/lib\/gmail\/discovery/);
  assert.match(handler, /import\("@\/lib\/gmail\/cron"\)/);
  assert.doesNotMatch(handler, /from "@\/lib\/gmail\/cron"/);
  const workerImport = handler.indexOf('import("@/lib/gmail/cron")');
  const authCheck = handler.indexOf("cronAuthorizationMatches");
  assert.ok(authCheck >= 0 && workerImport > authCheck);
  const pdfImport = extract.indexOf('from "pdfjs-dist/legacy/build/pdf.mjs"');
  const serverImport = extract.indexOf('import "@/lib/materials/invoices/pdf-server"');
  assert.ok(serverImport >= 0 && pdfImport > serverImport);
  assert.doesNotMatch(discovery, /from "@\/lib\/materials\/invoices\/extract"/);
  assert.match(discovery, /import\("@\/lib\/materials\/invoices\/extract"\)/);
});
