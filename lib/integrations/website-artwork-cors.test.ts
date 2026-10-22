import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OPTIONS as completeOptions } from "@/app/api/integrations/website/quote-requests/[id]/artwork/[fileId]/complete/route";
import { OPTIONS as chunkOptions } from "@/app/api/integrations/website/quote-requests/[id]/artwork/[fileId]/chunks/route";
import {
  WEBSITE_ARTWORK_CORS_DEV_ORIGINS_ENV,
  allowedWebsiteArtworkOrigin,
  websiteArtworkPreflight,
  withWebsiteArtworkCors,
} from "@/lib/integrations/website-artwork-cors";
import { clearWebsiteRateLimits } from "@/lib/integrations/website-rate-limit";
import { createMemoryArtworkDatabase } from "@/lib/quote-request/website-artwork-memory";
import {
  handleCompleteWebsiteArtwork,
  handleOpenWebsiteArtwork,
  handleWebsiteArtworkChunk,
  type WebsiteArtworkDeps,
} from "@/lib/quote-request/website-artwork";

const APEX = "https://candidcreative.uk";
const WWW = "https://www.candidcreative.uk";
const SECRET = "test-website-secret";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const originalNodeEnv = process.env.NODE_ENV;
const originalDevOrigins = process.env[WEBSITE_ARTWORK_CORS_DEV_ORIGINS_ENV];

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  if (originalDevOrigins === undefined) {
    delete process.env[WEBSITE_ARTWORK_CORS_DEV_ORIGINS_ENV];
  } else {
    process.env[WEBSITE_ARTWORK_CORS_DEV_ORIGINS_ENV] = originalDevOrigins;
  }
});

function request(origin: string | null, method = "OPTIONS") {
  return new Request("https://os.candidcreative.uk/artwork", {
    method,
    headers: origin ? { origin } : {},
  });
}

function assertCors(response: Response, origin: string) {
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal(
    response.headers.get("access-control-allow-headers"),
    "Authorization, Content-Type, x-upload-offset, x-chunk-sha256"
  );
  assert.equal(response.headers.get("access-control-max-age"), "600");
  assert.equal(response.headers.get("vary"), "Origin");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
}

function assertNoPermissiveCors(response: Response) {
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-methods"), null);
  assert.equal(response.headers.get("access-control-allow-headers"), null);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
}

describe("website artwork CORS allowlist", () => {
  test("allows the apex and www website origins", () => {
    assert.equal(allowedWebsiteArtworkOrigin(APEX), APEX);
    assert.equal(allowedWebsiteArtworkOrigin(WWW), WWW);
  });

  test("rejects a disallowed origin, a missing origin, and a wildcard", () => {
    assert.equal(allowedWebsiteArtworkOrigin("https://preview.vercel.app"), null);
    assert.equal(allowedWebsiteArtworkOrigin("https://candidcreative.uk.evil.example"), null);
    assert.equal(allowedWebsiteArtworkOrigin("*"), null);
    assert.equal(allowedWebsiteArtworkOrigin(null), null);
    assert.equal(allowedWebsiteArtworkOrigin("https://candidcreative.uk/upload"), null);
  });

  test("allows a localhost origin only when development explicitly configures it", () => {
    process.env.NODE_ENV = "production";
    process.env[WEBSITE_ARTWORK_CORS_DEV_ORIGINS_ENV] = "http://localhost:3000";
    assert.equal(allowedWebsiteArtworkOrigin("http://localhost:3000"), null);

    process.env.NODE_ENV = "development";
    delete process.env[WEBSITE_ARTWORK_CORS_DEV_ORIGINS_ENV];
    assert.equal(allowedWebsiteArtworkOrigin("http://localhost:3000"), null);

    process.env[WEBSITE_ARTWORK_CORS_DEV_ORIGINS_ENV] = "http://localhost:3000";
    assert.equal(allowedWebsiteArtworkOrigin("http://localhost:3000"), "http://localhost:3000");
    assert.equal(allowedWebsiteArtworkOrigin("http://localhost:3001"), null);
  });
});

describe("website artwork preflight", () => {
  test("answers an allowed chunk or completion preflight without credentials", () => {
    for (const origin of [APEX, WWW]) {
      const response = websiteArtworkPreflight(request(origin));
      assert.equal(response.status, 204);
      assertCors(response, origin);
    }

    const chunk = chunkOptions(request(APEX));
    const complete = completeOptions(request(WWW));
    assert.equal(chunk.status, 204);
    assert.equal(complete.status, 204);
    assertCors(chunk, APEX);
    assertCors(complete, WWW);
  });

  test("rejects a missing or disallowed preflight", () => {
    const missing = chunkOptions(request(null));
    const foreign = completeOptions(request("https://evil.example"));
    assert.equal(missing.status, 403);
    assert.equal(foreign.status, 403);
    assertNoPermissiveCors(missing);
    assertNoPermissiveCors(foreign);
  });
});

function memoryDeps(submissionId: string) {
  clearWebsiteRateLimits();
  const memory = createMemoryArtworkDatabase();
  const enquiryId = randomUUID();
  const now = new Date("2026-06-15T12:00:00.000Z");
  memory.enquiries.set(enquiryId, {
    id: enquiryId,
    source: "website",
    externalSubmissionId: submissionId,
    companyName: "Acme",
    projectName: "Banner",
    createdAt: now.toISOString(),
  });
  const deps: WebsiteArtworkDeps = {
    now: () => now,
    database: memory.database,
    secret: () => SECRET,
    dropbox: {
      configured: () => true,
      async createFolder() {},
      async startSession() {
        return "session-cors";
      },
      async append() {},
      async finish(input) {
        return { id: "id:artwork", path: input.dropboxPath.toLowerCase(), size: input.totalSize };
      },
      async findFile() {
        return null;
      },
      async temporaryLink() {
        return "https://dl.dropboxusercontent.example/temp";
      },
    },
  };

  return { enquiryId, deps };
}

async function openFile(submissionId: string, enquiryId: string, deps: WebsiteArtworkDeps) {
  const opened = await handleOpenWebsiteArtwork(
    new Request("https://os.candidcreative.uk/artwork", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({
        externalSubmissionId: submissionId,
        fileName: "panel.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 3,
      }),
    }),
    enquiryId,
    deps
  );
  return opened.json() as Promise<{ fileId: string; grant: string }>;
}

describe("website artwork upload responses", () => {
  test("keeps grant authentication and exposes the error to an approved browser origin", async () => {
    const { enquiryId, deps } = memoryDeps("web-cors-auth");
    const opened = await openFile("web-cors-auth", enquiryId, deps);
    const incoming = new Request("https://os.candidcreative.uk/chunk", {
      method: "POST",
      headers: { origin: APEX, authorization: "Bearer not-a-grant" },
    });
    const response = withWebsiteArtworkCors(
      incoming,
      await handleWebsiteArtworkChunk(incoming, enquiryId, opened.fileId, deps)
    );
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, "Unauthorized.");
    assertCors(response, APEX);
    assert.equal(JSON.stringify(body).includes("DROPBOX"), false);
    assert.equal(JSON.stringify(body).includes(SECRET), false);
  });

  test("rejects an invalid grant from an approved origin on completion", async () => {
    const { enquiryId, deps } = memoryDeps("web-cors-finish-auth");
    const opened = await openFile("web-cors-finish-auth", enquiryId, deps);
    const incoming = new Request("https://os.candidcreative.uk/complete", {
      method: "POST",
      headers: { origin: WWW, authorization: "Bearer not-a-grant" },
    });
    const response = withWebsiteArtworkCors(
      incoming,
      await handleCompleteWebsiteArtwork(incoming, enquiryId, opened.fileId, deps)
    );

    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "Unauthorized.");
    assertCors(response, WWW);
  });

  test("does not add CORS for a disallowed origin or a missing origin", async () => {
    const { enquiryId, deps } = memoryDeps("web-cors-foreign");
    const opened = await openFile("web-cors-foreign", enquiryId, deps);
    const foreignRequest = new Request("https://os.candidcreative.uk/chunk", {
      method: "POST",
      headers: { origin: "https://evil.example", authorization: "Bearer not-a-grant" },
    });
    const missingRequest = new Request("https://os.candidcreative.uk/complete", {
      method: "POST",
      headers: { authorization: "Bearer not-a-grant" },
    });
    const foreign = withWebsiteArtworkCors(
      foreignRequest,
      await handleWebsiteArtworkChunk(foreignRequest, enquiryId, opened.fileId, deps)
    );
    const missing = withWebsiteArtworkCors(
      missingRequest,
      await handleCompleteWebsiteArtwork(missingRequest, enquiryId, opened.fileId, deps)
    );

    assert.equal(foreign.status, 401);
    assert.equal(missing.status, 401);
    assertNoPermissiveCors(foreign);
    assertNoPermissiveCors(missing);
  });

  test("adds CORS to a successful and a failed chunk without changing the body", async () => {
    clearWebsiteRateLimits();
    const memory = createMemoryArtworkDatabase();
    const enquiryId = randomUUID();
    const now = new Date("2026-06-15T12:00:00.000Z");
    memory.enquiries.set(enquiryId, {
      id: enquiryId,
      source: "website",
      externalSubmissionId: "web-cors",
      companyName: "Acme",
      projectName: "Banner",
      createdAt: now.toISOString(),
    });
    const deps: WebsiteArtworkDeps = {
      now: () => now,
      database: memory.database,
      secret: () => SECRET,
      dropbox: {
        configured: () => true,
        async createFolder() {},
        async startSession() {
          return "session-cors";
        },
        async append() {},
        async finish(input) {
          return { id: "id:artwork", path: input.dropboxPath.toLowerCase(), size: input.totalSize };
        },
        async findFile() {
          return null;
        },
        async temporaryLink() {
          return "https://dl.dropboxusercontent.example/temp";
        },
      },
    };
    const opened = await handleOpenWebsiteArtwork(
      new Request("https://os.candidcreative.uk/artwork", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
        body: JSON.stringify({
          externalSubmissionId: "web-cors",
          fileName: "panel.pdf",
          mimeType: "application/pdf",
          fileSizeBytes: 3,
        }),
      }),
      enquiryId,
      deps
    );
    const openedBody = await opened.json();
    const bytes = new Uint8Array([1, 2, 3]);
    const chunk = new Request("https://os.candidcreative.uk/chunk", {
      method: "POST",
      headers: {
        origin: APEX,
        authorization: `Bearer ${openedBody.grant}`,
        "x-upload-offset": "0",
        "x-chunk-sha256": createHash("sha256").update(bytes).digest("hex"),
        "content-type": "application/octet-stream",
      },
      body: bytes,
    });
    const success = withWebsiteArtworkCors(
      chunk,
      await handleWebsiteArtworkChunk(chunk, enquiryId, openedBody.fileId, deps)
    );
    const successBody = await success.json();

    assert.equal(success.status, 200);
    assert.equal(successBody.ok, true);
    assert.equal(successBody.uploadedBytes, 3);
    assertCors(success, APEX);
    assert.equal(JSON.stringify(successBody).includes(SECRET), false);

    const failedRequest = new Request("https://os.candidcreative.uk/chunk", {
      method: "POST",
      headers: { origin: WWW, authorization: "Bearer expired-grant" },
    });
    const failed = withWebsiteArtworkCors(
      failedRequest,
      await handleWebsiteArtworkChunk(failedRequest, enquiryId, openedBody.fileId, deps)
    );

    assert.equal(failed.status, 401);
    assert.equal((await failed.json()).error, "Unauthorized.");
    assertCors(failed, WWW);
  });

  test("adds CORS to a successful and a failed completion", async () => {
    const uploaded = memoryDeps("web-cors-complete");
    const opened = await openFile("web-cors-complete", uploaded.enquiryId, uploaded.deps);
    const bytes = new Uint8Array([1, 2, 3]);
    const chunk = new Request("https://os.candidcreative.uk/chunk", {
      method: "POST",
      headers: {
        authorization: `Bearer ${opened.grant}`,
        "x-upload-offset": "0",
        "x-chunk-sha256": createHash("sha256").update(bytes).digest("hex"),
      },
      body: bytes,
    });
    assert.equal(
      (await handleWebsiteArtworkChunk(chunk, uploaded.enquiryId, opened.fileId, uploaded.deps)).status,
      200
    );
    const successRequest = new Request("https://os.candidcreative.uk/complete", {
      method: "POST",
      headers: { origin: APEX, authorization: `Bearer ${opened.grant}` },
    });
    const success = withWebsiteArtworkCors(
      successRequest,
      await handleCompleteWebsiteArtwork(successRequest, uploaded.enquiryId, opened.fileId, uploaded.deps)
    );
    const successBody = await success.json();

    assert.equal(success.status, 200);
    assert.equal(successBody.uploadStatus, "uploaded");
    assertCors(success, APEX);
    assert.equal(JSON.stringify(successBody).includes(opened.grant), false);
    assert.equal(JSON.stringify(successBody).includes(SECRET), false);

    const unfinished = memoryDeps("web-cors-unfinished");
    const unfinishedFile = await openFile("web-cors-unfinished", unfinished.enquiryId, unfinished.deps);
    const failedRequest = new Request("https://os.candidcreative.uk/complete", {
      method: "POST",
      headers: { origin: WWW, authorization: `Bearer ${unfinishedFile.grant}` },
    });
    const failed = withWebsiteArtworkCors(
      failedRequest,
      await handleCompleteWebsiteArtwork(
        failedRequest,
        unfinished.enquiryId,
        unfinishedFile.fileId,
        unfinished.deps
      )
    );

    assert.equal(failed.status, 409);
    assert.match((await failed.json()).error, /rest of the file/i);
    assertCors(failed, WWW);
  });
});

describe("website artwork CORS scope", () => {
  test("does not add browser CORS to enquiry, open, or renew routes", async () => {
    const files = [
      "app/api/integrations/website/quote-requests/route.ts",
      "app/api/integrations/website/quote-requests/[id]/artwork/route.ts",
      "app/api/integrations/website/quote-requests/[id]/artwork/[fileId]/renew/route.ts",
      "app/api/admin/quote-requests/[id]/artwork/[fileId]/route.ts",
    ];
    const sources = await Promise.all(
      files.map((file) => readFile(path.join(repoRoot, file), "utf8"))
    );

    for (const source of sources) {
      assert.doesNotMatch(source, /websiteArtworkPreflight|withWebsiteArtworkCors|Access-Control-Allow-Origin/);
    }

    const uploadRoutes = await Promise.all(
      [
        "app/api/integrations/website/quote-requests/[id]/artwork/[fileId]/chunks/route.ts",
        "app/api/integrations/website/quote-requests/[id]/artwork/[fileId]/complete/route.ts",
      ].map((file) => readFile(path.join(repoRoot, file), "utf8"))
    );

    for (const source of uploadRoutes) {
      assert.match(source, /export function OPTIONS/);
      assert.match(source, /return withWebsiteArtworkCors\(request, response\)/);
      assert.doesNotMatch(source, /Access-Control-Allow-Credentials/);
    }
  });
});
