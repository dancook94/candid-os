import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import { DropboxError } from "@/lib/dropbox/client";
import { clearWebsiteRateLimits } from "@/lib/integrations/website-rate-limit";
import {
  QUOTE_REQUEST_FILES_BUCKET,
  validateQuoteRequestFile,
} from "@/lib/quote-request-attachments";
import { createMemoryArtworkDatabase } from "@/lib/quote-request/website-artwork-memory";
import {
  buildWebsiteEnquiryFolderPath,
  isInsideEnquiryRoot,
  issueArtworkGrant,
  WEBSITE_ARTWORK_DEFAULT_ROOT,
  WEBSITE_ARTWORK_MAX_BYTES,
} from "@/lib/quote-request/website-artwork-policy";
import {
  handleAdminArtworkDownload,
  handleCompleteWebsiteArtwork,
  handleOpenWebsiteArtwork,
  handleRenewWebsiteArtwork,
  handleWebsiteArtworkChunk,
  type WebsiteArtworkDeps,
} from "@/lib/quote-request/website-artwork";

const SECRET = "test-website-secret";

function sha(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function setup() {
  clearWebsiteRateLimits();
  const memory = createMemoryArtworkDatabase();
  const quoteRequestId = randomUUID();
  const submissionId = "web-1001";
  let now = new Date("2026-06-15T12:00:00.000Z");
  const calls = {
    appends: 0,
    finishes: 0,
    links: [] as string[],
    failAppend: null as Error | null,
    existing: null as { id: string; path: string; size: number } | null,
  };

  memory.enquiries.set(quoteRequestId, {
    id: quoteRequestId,
    source: "website",
    externalSubmissionId: submissionId,
    companyName: "Acme",
    projectName: "Banner",
    createdAt: "2026-06-15T12:00:00.000Z",
  });

  const deps: WebsiteArtworkDeps = {
    now: () => now,
    database: memory.database,
    secret: () => SECRET,
    dropbox: {
      configured: () => true,
      async createFolder() {},
      async startSession() {
        return "session-test";
      },
      async append() {
        calls.appends += 1;
        if (calls.failAppend) {
          throw calls.failAppend;
        }
      },
      async finish(input) {
        calls.finishes += 1;
        return {
          id: "id:artwork",
          path: input.dropboxPath.toLowerCase(),
          size: input.totalSize,
        };
      },
      async findFile() {
        return calls.existing;
      },
      async temporaryLink(fileId) {
        calls.links.push(fileId);
        return "https://dl.dropboxusercontent.example/temp";
      },
    },
  };

  return {
    deps,
    memory,
    calls,
    quoteRequestId,
    submissionId,
    setNow(value: Date) {
      now = value;
    },
  };
}

function openRequest(submissionId: string, body: Record<string, unknown>) {
  return new Request("https://os.candidcreative.uk/api/integrations/website/quote-requests/x/artwork", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ externalSubmissionId: submissionId, ...body }),
  });
}

function chunkRequest(grant: string, offset: number, bytes: Uint8Array) {
  return new Request("https://os.candidcreative.uk/chunk", {
    method: "POST",
    headers: {
      authorization: `Bearer ${grant}`,
      "x-upload-offset": String(offset),
      "x-chunk-sha256": sha(bytes),
      "content-type": "application/octet-stream",
    },
    body: bytes,
  });
}

async function openFile(
  ctx: ReturnType<typeof setup>,
  file: { fileName?: string; mimeType?: string | null; fileSizeBytes?: number } = {}
) {
  const response = await handleOpenWebsiteArtwork(
    openRequest(ctx.submissionId, {
      fileName: file.fileName ?? "poster.pdf",
      mimeType: file.mimeType === undefined ? "application/pdf" : file.mimeType,
      fileSizeBytes: file.fileSizeBytes ?? 4,
    }),
    ctx.quoteRequestId,
    ctx.deps
  );
  const payload = (await response.json()) as {
    fileId?: string;
    grant?: string;
    error?: string;
  };
  return { response, payload };
}

describe("website artwork uploads", { concurrency: 1 }, () => {
  test("uploads a file in chunks and clears the session when it is complete", async () => {
    const ctx = setup();
    const opened = await openFile(ctx, { fileSizeBytes: 6 });
    assert.equal(opened.response.status, 201);
    assert.equal(typeof opened.payload.fileId, "string");
    assert.equal(opened.payload.grant?.includes(SECRET), false);
    const { grant: issuedGrant, ...publicFields } = opened.payload;
    assert.equal(JSON.stringify(publicFields).includes("session"), false);
    assert.equal(issuedGrant, opened.payload.grant);
    const decoded = JSON.parse(
      Buffer.from(opened.payload.grant!.split(".")[0], "base64url").toString("utf8")
    ) as { file: string; qr: string };
    assert.equal(decoded.file, opened.payload.fileId);
    assert.equal(decoded.qr, ctx.quoteRequestId);

    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const chunk = await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, bytes),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(chunk.status, 200);
    assert.equal(ctx.calls.appends, 1);

    const done = await handleCompleteWebsiteArtwork(
      new Request("https://os.candidcreative.uk/complete", {
        method: "POST",
        headers: { authorization: `Bearer ${opened.payload.grant}` },
      }),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(done.status, 200);
    const stored = ctx.memory.files.get(opened.payload.fileId!);
    assert.equal(stored?.uploadStatus, "uploaded");
    assert.equal(stored?.sessionId, null);
    assert.equal(stored?.dropboxFileId, "id:artwork");
    assert.equal(ctx.calls.finishes, 1);

    const again = await handleCompleteWebsiteArtwork(
      new Request("https://os.candidcreative.uk/complete", {
        method: "POST",
        headers: { authorization: `Bearer ${opened.payload.grant}` },
      }),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    const againBody = (await again.json()) as { duplicate?: boolean };
    assert.equal(again.status, 200);
    assert.equal(againBody.duplicate, true);
    assert.equal(ctx.calls.finishes, 1);
  });

  test("accepts several files and rejects the eleventh", async () => {
    const ctx = setup();

    for (let index = 0; index < 10; index += 1) {
      const opened = await openFile(ctx, { fileName: `file-${index}.pdf` });
      assert.equal(opened.response.status, 201);
    }

    const extra = await openFile(ctx, { fileName: "file-10.pdf" });
    assert.equal(extra.response.status, 409);
    assert.match(extra.payload.error ?? "", /10 files/);
  });

  test("rejects a file over 500 MB and a disallowed type", async () => {
    const ctx = setup();
    const huge = await openFile(ctx, { fileSizeBytes: WEBSITE_ARTWORK_MAX_BYTES + 1 });
    assert.equal(huge.response.status, 400);

    const executable = await openFile(ctx, { fileName: "installer.exe", mimeType: null });
    assert.equal(executable.response.status, 400);

    const mismatch = await openFile(ctx, { mimeType: "image/png" });
    assert.equal(mismatch.response.status, 400);
    assert.equal(ctx.memory.files.size, 0);
  });

  test("rejects a missing, tampered, or expired upload grant", async () => {
    const ctx = setup();
    const opened = await openFile(ctx);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const missing = await handleWebsiteArtworkChunk(
      chunkRequest("", 0, bytes),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(missing.status, 401);

    const tampered = `${opened.payload.grant!.slice(0, -1)}${opened.payload.grant!.endsWith("a") ? "b" : "a"}`;
    const invalid = await handleWebsiteArtworkChunk(
      chunkRequest(tampered, 0, bytes),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(invalid.status, 401);

    ctx.setNow(new Date("2026-06-15T13:00:00.000Z"));
    const expired = await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, bytes),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(expired.status, 401);
    assert.match((await expired.json()).error, /expired/);
  });

  test("renews an upload grant for the same file without the browser secret", async () => {
    const ctx = setup();
    const opened = await openFile(ctx, { fileSizeBytes: 4 });
    ctx.setNow(new Date("2026-06-15T12:40:00.000Z"));
    const renewed = await handleRenewWebsiteArtwork(
      new Request("https://os.candidcreative.uk/renew", {
        method: "POST",
        headers: {
          authorization: `Bearer ${SECRET}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ externalSubmissionId: ctx.submissionId }),
      }),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(renewed.status, 200);
    const payload = (await renewed.json()) as { grant: string };
    assert.notEqual(payload.grant, opened.payload.grant);
    const chunk = await handleWebsiteArtworkChunk(
      chunkRequest(payload.grant, 0, new Uint8Array([1, 2, 3, 4])),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(chunk.status, 200);
  });

  test("does not accept a submission id without the integration secret", async () => {
    const ctx = setup();
    const response = await handleOpenWebsiteArtwork(
      new Request("https://os.candidcreative.uk/artwork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          externalSubmissionId: ctx.submissionId,
          fileName: "poster.pdf",
          mimeType: "application/pdf",
          fileSizeBytes: 4,
        }),
      }),
      ctx.quoteRequestId,
      ctx.deps
    );
    assert.equal(response.status, 401);
    assert.equal(ctx.memory.files.size, 0);
  });

  test("rejects a grant used for another enquiry or another file", async () => {
    const ctx = setup();
    const first = await openFile(ctx, { fileName: "one.pdf" });
    const second = await openFile(ctx, { fileName: "two.pdf" });
    const otherEnquiry = randomUUID();
    ctx.memory.enquiries.set(otherEnquiry, {
      id: otherEnquiry,
      source: "website",
      externalSubmissionId: "web-2002",
      companyName: "Other",
      projectName: "Other",
      createdAt: "2026-06-15T12:00:00.000Z",
    });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const crossFile = await handleWebsiteArtworkChunk(
      chunkRequest(first.payload.grant!, 0, bytes),
      ctx.quoteRequestId,
      second.payload.fileId!,
      ctx.deps
    );
    assert.equal(crossFile.status, 403);

    const foreign = issueArtworkGrant({
      quoteRequestId: otherEnquiry,
      fileId: first.payload.fileId!,
      secret: SECRET,
      now: new Date("2026-06-15T12:00:00.000Z"),
    });
    const crossEnquiry = await handleWebsiteArtworkChunk(
      chunkRequest(foreign.grant, 0, bytes),
      ctx.quoteRequestId,
      first.payload.fileId!,
      ctx.deps
    );
    assert.equal(crossEnquiry.status, 403);
    assert.equal(ctx.calls.appends, 0);
  });

  test("rejects a skipped chunk and accepts an identical retry", async () => {
    const ctx = setup();
    const opened = await openFile(ctx, { fileSizeBytes: 8 });
    const first = new Uint8Array([1, 2, 3, 4]);
    const second = new Uint8Array([5, 6, 7, 8]);
    const skipped = await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 4, second),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(skipped.status, 409);
    assert.equal((await skipped.json()).committedOffset, 0);

    const saved = await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, first),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(saved.status, 200);
    const retry = await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, first),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal(ctx.calls.appends, 1);

    const changed = await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, new Uint8Array([9, 9, 9, 9])),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(changed.status, 409);
    assert.equal(ctx.memory.files.get(opened.payload.fileId!)?.uploadStatus, "pending");
  });

  test("lets only one concurrent chunk claim the same offset", async () => {
    const ctx = setup();
    const opened = await openFile(ctx, { fileSizeBytes: 4 });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.deps.dropbox.append = () => gate.then(() => undefined);
    const first = handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, bytes),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );

    let sawClaim = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (ctx.memory.files.get(opened.payload.fileId!)?.claimKind === "chunk") {
        sawClaim = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(sawClaim, true);

    const second = await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, bytes),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(second.status, 409);
    assert.match((await second.json()).error, /already being saved/);
    release?.();
    assert.equal((await first).status, 200);
    assert.equal(ctx.memory.files.get(opened.payload.fileId!)?.offset, 4);
  });

  test("keeps an interrupted upload pending and continues after a retry", async () => {
    const ctx = setup();
    const opened = await openFile(ctx, { fileSizeBytes: 4 });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    ctx.calls.failAppend = new Error("network");
    const failed = await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, bytes),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(failed.status, 502);
    assert.equal(ctx.memory.files.get(opened.payload.fileId!)?.uploadStatus, "pending");
    assert.equal(ctx.memory.files.get(opened.payload.fileId!)?.offset, 0);
    assert.equal(ctx.memory.files.get(opened.payload.fileId!)?.claimKind, null);

    ctx.calls.failAppend = null;
    const retried = await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, bytes),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(retried.status, 200);
  });

  test("marks an expired Dropbox session failed", async () => {
    const ctx = setup();
    const opened = await openFile(ctx, { fileSizeBytes: 4 });
    const file = ctx.memory.files.get(opened.payload.fileId!);
    file!.sessionExpiresAt = "2026-06-01T00:00:00.000Z";
    const response = await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, new Uint8Array([1, 2, 3, 4])),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(response.status, 409);
    assert.equal(file?.uploadStatus, "failed");
    assert.equal(file?.sessionId, null);
  });

  test("returns a temporary link only to an approved admin", async () => {
    const ctx = setup();
    const opened = await openFile(ctx, { fileSizeBytes: 4 });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, bytes),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    await handleCompleteWebsiteArtwork(
      new Request("https://os.candidcreative.uk/complete", {
        method: "POST",
        headers: { authorization: `Bearer ${opened.payload.grant}` },
      }),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    const stored = ctx.memory.files.get(opened.payload.fileId!);
    let links = 0;
    const denied = await handleAdminArtworkDownload(ctx.quoteRequestId, opened.payload.fileId!, {
      verifyAdmin: async () => ({ ok: false, status: 403, message: "Forbidden." }),
      readUploadedFile: async () => {
        throw new Error("should not read");
      },
      temporaryLink: async () => {
        links += 1;
        return "https://dl.dropboxusercontent.example/temp";
      },
      root: () => WEBSITE_ARTWORK_DEFAULT_ROOT,
    });
    assert.equal(denied.status, 403);
    assert.equal(links, 0);

    const allowed = await handleAdminArtworkDownload(ctx.quoteRequestId, opened.payload.fileId!, {
      verifyAdmin: async () => ({ ok: true }),
      readUploadedFile: async () => ({
        dropboxFileId: stored!.dropboxFileId!,
        dropboxPath: stored!.dropboxPath!,
      }),
      temporaryLink: async (fileId) => {
        links += 1;
        assert.equal(fileId, stored?.dropboxFileId);
        return "https://dl.dropboxusercontent.example/temp";
      },
      root: () => WEBSITE_ARTWORK_DEFAULT_ROOT,
    });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).url, "https://dl.dropboxusercontent.example/temp");
    assert.equal(links, 1);

    const pending = await handleAdminArtworkDownload(ctx.quoteRequestId, opened.payload.fileId!, {
      verifyAdmin: async () => ({ ok: true }),
      readUploadedFile: async () => null,
      temporaryLink: async () => {
        links += 1;
        return "https://dl.dropboxusercontent.example/temp";
      },
      root: () => WEBSITE_ARTWORK_DEFAULT_ROOT,
    });
    assert.equal(pending.status, 404);
    assert.equal(links, 1);
  });

  test("keeps portal attachment uploads on Supabase Storage", async () => {
    const portalFile = new File([new Uint8Array([37, 80, 68, 70])], "board.pdf", {
      type: "application/pdf",
    });
    assert.equal(validateQuoteRequestFile(portalFile), null);
    assert.equal(QUOTE_REQUEST_FILES_BUCKET, "quote-request-files");
    const migration = await readFile(
      "supabase/migrations/20261020130000_website_artwork_upload_sessions.sql",
      "utf8"
    );
    const handler = await readFile("lib/quote-request/website-artwork.ts", "utf8");
    const page = await readFile("app/admin/quote-requests/[id]/page.tsx", "utf8");
    assert.doesNotMatch(migration, /quote_request_attachments/);
    assert.doesNotMatch(handler, /downloadDropboxFile/);
    assert.match(page, /QuoteRequestAttachmentsList/);
    assert.match(page, /WebsiteEnquiryArtwork/);
  });

  test("builds a private folder from the enquiry id and sanitises the name", () => {
    const quoteRequestId = "11111111-1111-4111-8111-111111111111";
    const path = buildWebsiteEnquiryFolderPath({
      quoteRequestId,
      createdAt: new Date("2026-06-15T12:00:00.000Z"),
      companyName: "../Acme",
      projectName: "Shop banner",
      root: WEBSITE_ARTWORK_DEFAULT_ROOT,
    });
    assert.equal(path.includes(".."), false);
    assert.equal(path.startsWith(`${WEBSITE_ARTWORK_DEFAULT_ROOT}/2026/${quoteRequestId} - `), true);
    assert.equal(isInsideEnquiryRoot(`${path}/poster.pdf`, WEBSITE_ARTWORK_DEFAULT_ROOT), true);
    assert.equal(isInsideEnquiryRoot("/Candid OS Jobs/secret.pdf", WEBSITE_ARTWORK_DEFAULT_ROOT), false);
  });

  test("turns a Dropbox rate limit into a retryable response", async () => {
    const ctx = setup();
    const opened = await openFile(ctx, { fileSizeBytes: 4 });
    ctx.calls.failAppend = new DropboxError("too_many_requests/...", 429);
    const response = await handleWebsiteArtworkChunk(
      chunkRequest(opened.payload.grant!, 0, new Uint8Array([1, 2, 3, 4])),
      ctx.quoteRequestId,
      opened.payload.fileId!,
      ctx.deps
    );
    assert.equal(response.status, 429);
    assert.equal(ctx.memory.files.get(opened.payload.fileId!)?.uploadStatus, "pending");
    assert.equal(JSON.stringify(await response.json()).includes("too_many_requests"), false);
  });
});
