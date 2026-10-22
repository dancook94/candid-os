import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { OPTIONS as chunkOptions } from "@/app/api/integrations/website/quote-requests/[id]/artwork/[fileId]/chunks/route";
import { WEBSITE_API_SECRET_ENV } from "@/lib/integrations/website-api-auth";
import { websiteArtworkPreflight } from "@/lib/integrations/website-artwork-cors";
import {
  clearWebsiteRateLimits,
  consumeWebsiteRateLimit,
  trustedWebsiteClientIp,
  UPSTASH_REDIS_REST_TOKEN_ENV,
  UPSTASH_REDIS_REST_URL_ENV,
  useWebsiteRateLimitStoreForTests,
  WEBSITE_ARTWORK_CHUNK_FILE_LIMIT,
  WEBSITE_ARTWORK_CHUNK_IP_LIMIT,
  WEBSITE_AUTH_FAILURE_LIMIT,
  WEBSITE_ENQUIRY_LIMIT,
  WEBSITE_RATE_LIMIT_MODE_ENV,
  websiteRateLimitKeysForTests,
  websiteRateLimitOperations,
  type WebsiteRateLimitKind,
} from "@/lib/integrations/website-rate-limit";
import { handleWebsiteQuoteRequest } from "@/lib/integrations/website-quote-request";
import { handleRenewWebsiteArtwork, handleWebsiteArtworkChunk, type WebsiteArtworkDeps } from "@/lib/quote-request/website-artwork";
import { createMemoryArtworkDatabase } from "@/lib/quote-request/website-artwork-memory";
import { issueArtworkGrant } from "@/lib/quote-request/website-artwork-policy";

const SECRET = "test-website-secret";
const ENQUIRY = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";
const OTHER_FILE = "33333333-3333-4333-8333-333333333333";

const original = {
  nodeEnv: process.env.NODE_ENV,
  mode: process.env[WEBSITE_RATE_LIMIT_MODE_ENV],
  redisUrl: process.env[UPSTASH_REDIS_REST_URL_ENV],
  redisToken: process.env[UPSTASH_REDIS_REST_TOKEN_ENV],
  secret: process.env[WEBSITE_API_SECRET_ENV],
};

afterEach(() => {
  restoreEnv(original.nodeEnv, "NODE_ENV");
  restoreEnv(original.mode, WEBSITE_RATE_LIMIT_MODE_ENV);
  restoreEnv(original.redisUrl, UPSTASH_REDIS_REST_URL_ENV);
  restoreEnv(original.redisToken, UPSTASH_REDIS_REST_TOKEN_ENV);
  restoreEnv(original.secret, WEBSITE_API_SECRET_ENV);
  clearWebsiteRateLimits();
});

function restoreEnv(value: string | undefined, name: string) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function request(headers: Record<string, string> = {}) {
  return new Request("https://os.candidcreative.uk/api/integrations/website/quote-requests", {
    method: "POST",
    headers,
  });
}

function trusted(ip: string, extra: Record<string, string> = {}) {
  return request({
    "x-vercel-forwarded-for": ip,
    ...extra,
  });
}

async function consume(
  kind: WebsiteRateLimitKind,
  ip: string,
  scopeId?: string,
  extra: Record<string, string> = {}
) {
  return consumeWebsiteRateLimit({
    kind,
    request: trusted(ip, extra),
    pepper: SECRET,
    scopeId,
  });
}

describe("shared website rate limit", () => {
  test("allows requests below the enquiry limit and rejects the next one", async () => {
    for (let attempt = 0; attempt < WEBSITE_ENQUIRY_LIMIT; attempt += 1) {
      assert.equal((await consume("enquiry", "203.0.113.10")).status, "allowed");
    }

    const blocked = await consume("enquiry", "203.0.113.10");
    assert.equal(blocked.status, "limited");
    if (blocked.status === "limited") {
      assert.ok(blocked.retryAfterSeconds > 0);
    }
  });

  test("shares one quota across concurrent requests", async () => {
    const results = await Promise.all(
      Array.from({ length: WEBSITE_ENQUIRY_LIMIT }, () => consume("enquiry", "203.0.113.11"))
    );

    assert.equal(results.every((result) => result.status === "allowed"), true);
    assert.equal((await consume("enquiry", "203.0.113.11")).status, "limited");
  });

  test("limits failed secrets per IP without blocking a different visitor", async () => {
    for (let attempt = 0; attempt < WEBSITE_AUTH_FAILURE_LIMIT; attempt += 1) {
      assert.equal((await consume("auth_failure", "203.0.113.12")).status, "allowed");
    }

    assert.equal((await consume("auth_failure", "203.0.113.12")).status, "limited");
    assert.equal((await consume("auth_failure", "203.0.113.13")).status, "allowed");
    assert.equal((await consume("enquiry", "203.0.113.12")).status, "allowed");
  });

  test("ignores a spoofed forwarding header and hashes the trusted IP", async () => {
    assert.equal(
      trustedWebsiteClientIp(
        request({
          "x-forwarded-for": "198.51.100.20",
          "x-vercel-forwarded-for": "203.0.113.14",
        })
      ),
      "203.0.113.14"
    );
    assert.equal(trustedWebsiteClientIp(request({ "x-forwarded-for": "198.51.100.21" })), "unknown");

    await consume("enquiry", "203.0.113.14", undefined, { "x-forwarded-for": "198.51.100.22" });
    const keys = websiteRateLimitKeysForTests().join(" ");
    assert.equal(keys.includes("203.0.113.14"), false);
    assert.equal(keys.includes(SECRET), false);
    assert.match(keys, /candid-os:website:enquiry:/);
  });

  test("allows a 500 MB ten-file upload and still caps one file", async () => {
    const files = Array.from({ length: 10 }, (_, index) =>
      `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`
    );

    for (const fileId of files) {
      for (let chunk = 0; chunk < 125; chunk += 1) {
        assert.equal((await consume("artwork_chunk", "203.0.113.15", fileId)).status, "allowed");
      }
    }

    assert.equal((await consume("artwork_chunk", "203.0.113.15", files[0])).status, "allowed");

    for (let chunk = 0; chunk < WEBSITE_ARTWORK_CHUNK_FILE_LIMIT; chunk += 1) {
      assert.equal((await consume("artwork_chunk", "203.0.113.16", FILE)).status, "allowed");
    }

    assert.equal((await consume("artwork_chunk", "203.0.113.16", FILE)).status, "limited");
    assert.equal((await consume("artwork_chunk", "203.0.113.16", OTHER_FILE)).status, "allowed");
    assert.ok(1250 < WEBSITE_ARTWORK_CHUNK_IP_LIMIT);
  });

  test("does not answer preflight with Redis and keeps CORS closed", async () => {
    clearWebsiteRateLimits();
    const response = chunkOptions(request({ origin: "https://candidcreative.uk" }));
    const foreign = websiteArtworkPreflight(
      new Request("https://os.candidcreative.uk/artwork", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      })
    );

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://candidcreative.uk");
    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers.get("access-control-allow-origin"), null);
    assert.equal(websiteRateLimitOperations(), 0);
  });

  test("fails closed when Redis is missing or unavailable in production", async () => {
    process.env.NODE_ENV = "production";
    process.env[WEBSITE_RATE_LIMIT_MODE_ENV] = "memory";
    delete process.env[UPSTASH_REDIS_REST_URL_ENV];
    delete process.env[UPSTASH_REDIS_REST_TOKEN_ENV];
    clearWebsiteRateLimits();

    assert.throws(
      () => useWebsiteRateLimitStoreForTests({ async hit() { return { allowed: true, retryAfterSeconds: 0 }; } }),
      /refused in production/
    );
    assert.equal((await consume("enquiry", "203.0.113.17")).status, "unavailable");

    process.env.NODE_ENV = "development";
    clearWebsiteRateLimits();
    useWebsiteRateLimitStoreForTests({
      async hit() {
        throw new Error("redis token super-secret");
      },
    });
    const unavailable = await consume("enquiry", "203.0.113.17");
    assert.equal(unavailable.status, "unavailable");
    assert.equal(JSON.stringify(unavailable).includes("super-secret"), false);
  });
});

describe("website handlers honour the shared limiter", () => {
  test("rejects an invalid secret and accepts a valid one without Redis", async () => {
    process.env[WEBSITE_API_SECRET_ENV] = SECRET;
    const body = {
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      projectName: "Banner",
      projectDescription: "A large outdoor banner.",
      externalSubmissionId: "web-rate-1",
    };
    const denied = await handleWebsiteQuoteRequest(
      trusted("203.0.113.30", {
        authorization: "Bearer wrong-secret",
        "content-type": "application/json",
      }),
      { createAdmin: () => { throw new Error("database"); } }
    );
    assert.equal(denied.status, 401);

    const rows: Array<Record<string, unknown>> = [];
    const created = await handleWebsiteQuoteRequest(
      new Request("https://os.candidcreative.uk/api/integrations/website/quote-requests", {
        method: "POST",
        headers: {
          authorization: `Bearer ${SECRET}`,
          "content-type": "application/json",
          "x-vercel-forwarded-for": "203.0.113.31",
        },
        body: JSON.stringify(body),
      }),
      { createAdmin: () => memoryAdmin(rows) }
    );
    assert.equal(created.status, 201);

    const duplicate = await handleWebsiteQuoteRequest(
      new Request("https://os.candidcreative.uk/api/integrations/website/quote-requests", {
        method: "POST",
        headers: {
          authorization: `Bearer ${SECRET}`,
          "content-type": "application/json",
          "x-vercel-forwarded-for": "203.0.113.31",
        },
        body: JSON.stringify(body),
      }),
      { createAdmin: () => memoryAdmin(rows) }
    );
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);
  });

  test("returns 503 before saving an enquiry when the limiter is unavailable", async () => {
    process.env.NODE_ENV = "production";
    process.env[WEBSITE_API_SECRET_ENV] = SECRET;
    delete process.env[UPSTASH_REDIS_REST_URL_ENV];
    delete process.env[UPSTASH_REDIS_REST_TOKEN_ENV];
    clearWebsiteRateLimits();
    let created = false;
    const response = await handleWebsiteQuoteRequest(
      trusted("203.0.113.32", { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }),
      {
        createAdmin() {
          created = true;
          throw new Error("database");
        },
      }
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Website API is temporarily unavailable." });
    assert.equal(created, false);
  });

  test("rejects a chunk over the file cap and an invalid grant before Dropbox", async () => {
    process.env[WEBSITE_API_SECRET_ENV] = SECRET;
    const now = new Date("2026-06-15T12:00:00.000Z");
    const issued = issueArtworkGrant({
      quoteRequestId: ENQUIRY,
      fileId: FILE,
      secret: SECRET,
      now,
    });
    let dropped = false;
    const deps = {
      now: () => now,
      secret: () => SECRET,
      database: {
        async readFile() {
          throw new Error("database");
        },
      },
      dropbox: {
        async append() {
          dropped = true;
        },
      },
    } as unknown as WebsiteArtworkDeps;

    for (let chunk = 0; chunk < WEBSITE_ARTWORK_CHUNK_FILE_LIMIT; chunk += 1) {
      assert.equal((await consume("artwork_chunk", "203.0.113.40", FILE)).status, "allowed");
    }

    const limited = await handleWebsiteArtworkChunk(
      trusted("203.0.113.40", { authorization: `Bearer ${issued.grant}` }),
      ENQUIRY,
      FILE,
      deps
    );
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error, "Too many requests.");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(dropped, false);

    clearWebsiteRateLimits();
    const invalid = await handleWebsiteArtworkChunk(
      trusted("203.0.113.41", { authorization: "Bearer not-a-grant" }),
      ENQUIRY,
      FILE,
      deps
    );
    assert.equal(invalid.status, 401);
    assert.equal(dropped, false);
  });

  test("renews a grant for the same file", async () => {
    process.env[WEBSITE_API_SECRET_ENV] = SECRET;
    const memory = createMemoryArtworkDatabase();
    const now = new Date("2026-06-15T12:00:00.000Z");
    memory.enquiries.set(ENQUIRY, {
      id: ENQUIRY,
      source: "website",
      externalSubmissionId: "web-rate-renew",
      companyName: "Acme",
      projectName: "Banner",
      createdAt: now.toISOString(),
    });
    const opened = await (await import("@/lib/quote-request/website-artwork")).handleOpenWebsiteArtwork(
      new Request("https://os.candidcreative.uk/artwork", {
        method: "POST",
        headers: {
          authorization: `Bearer ${SECRET}`,
          "content-type": "application/json",
          "x-vercel-forwarded-for": "203.0.113.50",
        },
        body: JSON.stringify({
          externalSubmissionId: "web-rate-renew",
          fileName: "panel.pdf",
          mimeType: "application/pdf",
          fileSizeBytes: 3,
        }),
      }),
      ENQUIRY,
      {
        now: () => now,
        database: memory.database,
        secret: () => SECRET,
        dropbox: {
          configured: () => true,
          async createFolder() {},
          async startSession() {
            return "session-rate";
          },
          async append() {},
          async finish() {
            throw new Error("finish");
          },
          async findFile() {
            return null;
          },
          async temporaryLink() {
            return "https://dl.dropboxusercontent.example/temp";
          },
        },
      }
    );
    const openedBody = await opened.json();
    const renewed = await handleRenewWebsiteArtwork(
      new Request("https://os.candidcreative.uk/renew", {
        method: "POST",
        headers: {
          authorization: `Bearer ${SECRET}`,
          "content-type": "application/json",
          "x-vercel-forwarded-for": "203.0.113.50",
        },
        body: JSON.stringify({ externalSubmissionId: "web-rate-renew" }),
      }),
      ENQUIRY,
      openedBody.fileId,
      {
        now: () => now,
        database: memory.database,
        secret: () => SECRET,
        dropbox: {
          configured: () => true,
          async createFolder() {},
          async startSession() {
            return "session-rate";
          },
          async append() {},
          async finish() {
            throw new Error("finish");
          },
          async findFile() {
            return null;
          },
          async temporaryLink() {
            return "https://dl.dropboxusercontent.example/temp";
          },
        },
      }
    );

    assert.equal(opened.status, 201);
    assert.equal(renewed.status, 200);
    assert.equal(typeof (await renewed.json()).grant, "string");
  });
});

function memoryAdmin(rows: Array<Record<string, unknown>>) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        limit() {
          return builder;
        },
        insert(row: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  if (
                    table === "quote_requests" &&
                    rows.some((existing) => existing.external_submission_id === row.external_submission_id)
                  ) {
                    return { data: null, error: { code: "23505", message: "duplicate" } };
                  }

                  const stored = {
                    ...row,
                    id: ENQUIRY,
                    created_at: "2026-06-15T12:00:00.000Z",
                  };
                  rows.push(stored);
                  return { data: stored, error: null };
                },
              };
            },
          };
        },
        async maybeSingle() {
          const found = rows.find(
            (row) => row.external_submission_id === filters.external_submission_id && row.source === "website"
          );
          return { data: found ?? null, error: null };
        },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          if (table === "contacts") {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }

          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}
