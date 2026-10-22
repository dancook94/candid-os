import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { DropboxError } from "@/lib/dropbox/client";
import { cronAuthorizationMatches } from "@/lib/gmail/cron-auth";
import {
  consumeWebsiteRateLimit,
  type WebsiteRateLimitKind,
  type WebsiteRateLimitResult,
} from "@/lib/integrations/website-rate-limit";
import { websiteApiSecret } from "@/lib/integrations/website-api-auth";
import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createDropboxArtworkClient,
  createSupabaseArtworkDatabase,
  type ArtworkDatabase,
  type ArtworkOutcome,
  type WebsiteArtworkDropbox,
} from "@/lib/quote-request/website-artwork-db";
import {
  assertSubmissionId,
  buildWebsiteEnquiryFolderPath,
  grantAllows,
  isInsideEnquiryRoot,
  issueArtworkGrant,
  readArtworkGrant,
  sanitizeWebsiteArtworkFileName,
  validateWebsiteArtworkFile,
  websiteEnquiryRoot,
  WEBSITE_ARTWORK_CHUNK_BYTES,
  WebsiteArtworkError,
} from "@/lib/quote-request/website-artwork-policy";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_FIELDS = new Set([
  "externalSubmissionId",
  "fileName",
  "mimeType",
  "fileSizeBytes",
]);

export type WebsiteArtworkDeps = {
  now: () => Date;
  database: ArtworkDatabase;
  dropbox: WebsiteArtworkDropbox;
  secret: () => string | null;
};

type AdminDownloadDeps = {
  verifyAdmin: () => Promise<{ ok: true } | { ok: false; status: number; message: string }>;
  readUploadedFile: (
    quoteRequestId: string,
    fileId: string
  ) => Promise<{ dropboxFileId: string; dropboxPath: string } | null>;
  temporaryLink: (fileId: string) => Promise<string>;
  root: () => string;
};

function json(body: Record<string, unknown>, status: number, retryAfterSeconds?: number) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };

  if (status === 429 && retryAfterSeconds) {
    headers["Retry-After"] = String(retryAfterSeconds);
  }

  return NextResponse.json(body, {
    status,
    headers,
  });
}

function artworkError(error: unknown) {
  if (error instanceof WebsiteArtworkError) {
    return json(
      {
        error: error.message,
        ...(error.committedOffset === undefined
          ? {}
          : { committedOffset: error.committedOffset }),
      },
      error.status,
      error.retryAfterSeconds
    );
  }

  console.error("[website artwork]", {
    outcome: "unexpected",
  });
  return json({ error: "The artwork could not be saved." }, 500);
}

function requireUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new WebsiteArtworkError(`${label} is invalid.`, 400);
  }
}

function rejectRateLimit(result: Exclude<WebsiteRateLimitResult, { status: "allowed" }>): never {
  if (result.status === "unavailable") {
    throw new WebsiteArtworkError("Website API is temporarily unavailable.", 503);
  }

  const error = new WebsiteArtworkError("Too many requests.", 429);
  error.retryAfterSeconds = result.retryAfterSeconds;
  throw error;
}

async function enforceWebsiteRateLimit(
  request: Request,
  secret: string,
  kind: WebsiteRateLimitKind,
  scopeId?: string
) {
  const result = await consumeWebsiteRateLimit({
    kind,
    request,
    pepper: secret,
    scopeId,
  });

  if (result.status !== "allowed") {
    rejectRateLimit(result);
  }
}

async function authorizeSecret(
  request: Request,
  secret: string | null,
  kind: "artwork_open" | "artwork_renew",
  scopeId: string
) {
  if (!secret) {
    throw new WebsiteArtworkError("Website API is not configured.", 503);
  }

  if (!cronAuthorizationMatches(request.headers.get("authorization"), secret)) {
    await enforceWebsiteRateLimit(request, secret, "auth_failure");
    throw new WebsiteArtworkError("Unauthorized.", 401);
  }

  await enforceWebsiteRateLimit(request, secret, kind, scopeId);
}

async function readLimitedText(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new WebsiteArtworkError("The request is too large.", 413);
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    received += value.byteLength;

    if (received > maxBytes) {
      await reader.cancel();
      throw new WebsiteArtworkError("The request is too large.", 413);
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readChunkBytes(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "");

  if (Number.isFinite(declared) && declared > WEBSITE_ARTWORK_CHUNK_BYTES) {
    throw new WebsiteArtworkError("Chunk exceeds 4 MB.", 413);
  }

  if (!request.body) {
    throw new WebsiteArtworkError("Chunk is required.", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    received += value.byteLength;

    if (received > WEBSITE_ARTWORK_CHUNK_BYTES) {
      await reader.cancel();
      throw new WebsiteArtworkError("Chunk exceeds 4 MB.", 413);
    }

    chunks.push(value);
  }

  if (received === 0) {
    throw new WebsiteArtworkError("Chunk is required.", 400);
  }

  return Buffer.concat(chunks);
}

function requireObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebsiteArtworkError("The request could not be read.", 400);
  }

  return value as Record<string, unknown>;
}

function classifyDropbox(error: unknown) {
  if (!(error instanceof DropboxError)) {
    return "retryable" as const;
  }

  const message = error.message.toLowerCase();

  if (error.status === 429 || message.includes("too_many_requests")) {
    return "rate_limit" as const;
  }

  if (message.includes("not_found")) {
    return "session_dead" as const;
  }

  if (message.includes("incorrect_offset")) {
    return "offset" as const;
  }

  return "retryable" as const;
}

function logArtwork(outcome: string, quoteRequestId: string, fileId: string | null) {
  console.error("[website artwork]", {
    outcome,
    quoteRequestId,
    fileId,
  });
}

async function matchingEnquiry(
  database: ArtworkDatabase,
  quoteRequestId: string,
  externalSubmissionId: string
) {
  const enquiry = await database.getEnquiry(quoteRequestId);

  if (
    !enquiry ||
    enquiry.source !== "website" ||
    enquiry.externalSubmissionId !== externalSubmissionId
  ) {
    throw new WebsiteArtworkError("Enquiry not found.", 404);
  }

  return enquiry;
}

function grantFor(secret: string, quoteRequestId: string, fileId: string, now: Date) {
  return issueArtworkGrant({
    quoteRequestId,
    fileId,
    secret,
    now,
  });
}

function outcomeOffset(outcome: ArtworkOutcome) {
  return outcome.committedOffset;
}

export async function handleOpenWebsiteArtwork(
  request: Request,
  quoteRequestId: string,
  deps: WebsiteArtworkDeps = defaultDeps()
) {
  try {
    requireUuid(quoteRequestId, "Quote request id");
    await authorizeSecret(request, deps.secret(), "artwork_open", quoteRequestId);
    const body = requireObject(JSON.parse(await readLimitedText(request, 16_384) || "null"));
    const unexpected = Object.keys(body).filter((key) => !OPEN_FIELDS.has(key));

    if (unexpected.length > 0) {
      throw new WebsiteArtworkError("The request could not be read.", 400);
    }

    const externalSubmissionId = assertSubmissionId(body.externalSubmissionId);
    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : null;
    const fileSizeBytes = body.fileSizeBytes;
    const validationError = validateWebsiteArtworkFile({
      fileName,
      mimeType,
      fileSizeBytes: typeof fileSizeBytes === "number" ? fileSizeBytes : 0,
    });

    if (validationError || typeof fileSizeBytes !== "number") {
      throw new WebsiteArtworkError(validationError ?? "File name is required.", 400);
    }

    if (!deps.dropbox.configured()) {
      throw new WebsiteArtworkError("Artwork storage is not configured.", 503);
    }

    const enquiry = await matchingEnquiry(deps.database, quoteRequestId, externalSubmissionId);
    const createdAt = new Date(enquiry.createdAt);

    if (Number.isNaN(createdAt.getTime())) {
      throw new WebsiteArtworkError("The enquiry date could not be used.", 500);
    }

    const folderPath = buildWebsiteEnquiryFolderPath({
      quoteRequestId,
      createdAt,
      companyName: enquiry.companyName,
      projectName: enquiry.projectName,
    });
    const now = deps.now();
    const reserved = await deps.database.reserveFile({
      quoteRequestId,
      externalSubmissionId,
      originalFileName: fileName.trim(),
      storedFileName: sanitizeWebsiteArtworkFileName(fileName),
      folderPath,
      fileSizeBytes,
      mimeType,
      now,
    });

    if (reserved.outcome === "file_limit") {
      throw new WebsiteArtworkError("This enquiry already has the maximum of 10 files.", 409);
    }

    if (reserved.outcome === "too_large") {
      throw new WebsiteArtworkError("File exceeds the maximum upload size of 500 MB.", 400);
    }

    if (reserved.outcome === "invalid_path") {
      throw new WebsiteArtworkError("The artwork folder could not be created.", 500);
    }

    if (reserved.outcome === "name_taken") {
      throw new WebsiteArtworkError("This file name could not be stored.", 409);
    }

    if (reserved.outcome !== "reserved" || !reserved.fileId || !reserved.dropboxPath) {
      throw new WebsiteArtworkError("Enquiry not found.", 404);
    }

    const secret = deps.secret();

    if (!secret) {
      throw new WebsiteArtworkError("Website API is not configured.", 503);
    }

    try {
      const root = websiteEnquiryRoot();
      const yearFolder = folderPath.split("/").slice(0, -1).join("/");
      await deps.dropbox.createFolder(root);
      await deps.dropbox.createFolder(yearFolder);
      await deps.dropbox.createFolder(folderPath);
      const sessionId = await deps.dropbox.startSession();
      const attached = await deps.database.attachSession({
        quoteRequestId,
        fileId: reserved.fileId,
        sessionId,
        now,
      });

      if (attached.outcome !== "attached") {
        throw new WebsiteArtworkError("The artwork could not be saved.", 502);
      }
    } catch (error) {
      await deps.database.failFile(quoteRequestId, reserved.fileId);
      if (error instanceof WebsiteArtworkError) {
        throw error;
      }
      logArtwork(classifyDropbox(error), quoteRequestId, reserved.fileId);
      throw new WebsiteArtworkError("The artwork could not be saved.", 502);
    }

    const issued = grantFor(secret, quoteRequestId, reserved.fileId, now);

    return json(
      {
        ok: true,
        fileId: reserved.fileId,
        chunkSizeBytes: WEBSITE_ARTWORK_CHUNK_BYTES,
        uploadedBytes: 0,
        totalBytes: fileSizeBytes,
        grant: issued.grant,
        grantExpiresAt: issued.expiresAt,
      },
      201
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ error: "The request could not be read." }, 400);
    }

    return artworkError(error);
  }
}

export async function handleRenewWebsiteArtwork(
  request: Request,
  quoteRequestId: string,
  fileId: string,
  deps: WebsiteArtworkDeps = defaultDeps()
) {
  try {
    requireUuid(quoteRequestId, "Quote request id");
    requireUuid(fileId, "File id");
    await authorizeSecret(request, deps.secret(), "artwork_renew", fileId);
    const body = requireObject(JSON.parse(await readLimitedText(request, 4_096) || "null"));

    if (Object.keys(body).some((key) => key !== "externalSubmissionId")) {
      throw new WebsiteArtworkError("The request could not be read.", 400);
    }

    const externalSubmissionId = assertSubmissionId(body.externalSubmissionId);
    await matchingEnquiry(deps.database, quoteRequestId, externalSubmissionId);
    const now = deps.now();
    await deps.database.expireEnquiry(quoteRequestId, now);
    const file = await deps.database.readFile(quoteRequestId, fileId);

    if (!file) {
      throw new WebsiteArtworkError("Enquiry not found.", 404);
    }

    if (file.uploadStatus === "uploaded") {
      throw new WebsiteArtworkError("This file has already been uploaded.", 409);
    }

    if (
      file.uploadStatus !== "pending" ||
      !file.dropboxUploadSessionId ||
      (file.sessionExpiresAt !== null && new Date(file.sessionExpiresAt).getTime() <= now.getTime())
    ) {
      await deps.database.failFile(quoteRequestId, fileId);
      throw new WebsiteArtworkError(
        "This upload can no longer be continued. Start the file again.",
        409
      );
    }

    const secret = deps.secret();

    if (!secret || file.fileSizeBytes === null) {
      throw new WebsiteArtworkError("Website API is not configured.", 503);
    }

    const issued = grantFor(secret, quoteRequestId, fileId, now);

    return json(
      {
        ok: true,
        fileId,
        chunkSizeBytes: WEBSITE_ARTWORK_CHUNK_BYTES,
        uploadedBytes: file.uploadSessionOffset,
        totalBytes: file.fileSizeBytes,
        grant: issued.grant,
        grantExpiresAt: issued.expiresAt,
      },
      200
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ error: "The request could not be read." }, 400);
    }

    return artworkError(error);
  }
}

async function readGrant(
  request: Request,
  secret: string | null,
  now: Date,
  kind: "artwork_chunk" | "artwork_complete",
  fileId: string
) {
  if (!secret) {
    throw new WebsiteArtworkError("Website API is not configured.", 503);
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const grant = readArtworkGrant(token, secret, now);

  if (grant === "expired") {
    await enforceWebsiteRateLimit(request, secret, "auth_failure");
    throw new WebsiteArtworkError("The upload authorisation has expired.", 401);
  }

  if (grant === "invalid") {
    await enforceWebsiteRateLimit(request, secret, "auth_failure");
    throw new WebsiteArtworkError("Unauthorized.", 401);
  }

  await enforceWebsiteRateLimit(request, secret, kind, fileId);
  return grant;
}

export async function handleWebsiteArtworkChunk(
  request: Request,
  quoteRequestId: string,
  fileId: string,
  deps: WebsiteArtworkDeps = defaultDeps()
) {
  try {
    requireUuid(quoteRequestId, "Quote request id");
    requireUuid(fileId, "File id");
    const now = deps.now();
    const grant = await readGrant(request, deps.secret(), now, "artwork_chunk", fileId);
    const file = await deps.database.readFile(quoteRequestId, fileId);

    if (!file || file.fileSizeBytes === null) {
      throw new WebsiteArtworkError("Unauthorized.", 401);
    }

    if (
      !grantAllows(grant, {
        quoteRequestId,
        fileId,
        operation: "chunk",
        fileSizeBytes: file.fileSizeBytes,
      })
    ) {
      throw new WebsiteArtworkError("This upload authorisation does not match this file.", 403);
    }

    const offset = Number(request.headers.get("x-upload-offset"));
    const declaredHash = request.headers.get("x-chunk-sha256")?.trim().toLowerCase() ?? "";

    if (!Number.isInteger(offset) || offset < 0) {
      throw new WebsiteArtworkError("Upload offset is invalid.", 400);
    }

    if (!/^[0-9a-f]{64}$/.test(declaredHash)) {
      throw new WebsiteArtworkError("Chunk checksum is invalid.", 400);
    }

    const bytes = await readChunkBytes(request);
    const actualHash = createHash("sha256").update(bytes).digest("hex");

    if (actualHash !== declaredHash) {
      throw new WebsiteArtworkError("Chunk checksum is invalid.", 400);
    }

    const claim = await deps.database.claimChunk({
      quoteRequestId,
      fileId,
      offset,
      bytes: bytes.byteLength,
      sha256: actualHash,
      now,
    });

    if (claim.outcome === "duplicate") {
      return json(
        {
          ok: true,
          duplicate: true,
          uploadedBytes: claim.committedOffset ?? offset + bytes.byteLength,
          totalBytes: file.fileSizeBytes,
        },
        200
      );
    }

    if (claim.outcome === "busy") {
      throw new WebsiteArtworkError(
        "This chunk is already being saved.",
        409,
        outcomeOffset(claim)
      );
    }

    if (claim.outcome === "gap") {
      throw new WebsiteArtworkError(
        "Upload the earlier part of the file first.",
        409,
        outcomeOffset(claim)
      );
    }

    if (claim.outcome === "conflict") {
      throw new WebsiteArtworkError(
        "This part of the file was already received with different contents.",
        409,
        outcomeOffset(claim)
      );
    }

    if (claim.outcome === "chunk_too_large") {
      throw new WebsiteArtworkError("Chunk exceeds 4 MB.", 413);
    }

    if (claim.outcome === "exceeds") {
      throw new WebsiteArtworkError("Chunk exceeds the declared file size.", 400);
    }

    if (claim.outcome === "expired" || claim.outcome === "no_session" || claim.outcome === "failed") {
      throw new WebsiteArtworkError(
        "This upload can no longer be continued. Start the file again.",
        409
      );
    }

    if (claim.outcome === "already_uploaded") {
      throw new WebsiteArtworkError("This file has already been uploaded.", 409);
    }

    if (claim.outcome !== "proceed" || !claim.sessionId) {
      throw new WebsiteArtworkError("Unauthorized.", 401);
    }

    try {
      await deps.dropbox.append(claim.sessionId, offset, bytes);
    } catch (error) {
      const kind = classifyDropbox(error);
      logArtwork(kind, quoteRequestId, fileId);

      if (kind === "rate_limit") {
        await deps.database.releaseClaim({
          quoteRequestId,
          fileId,
          kind: "chunk",
          offset,
        });
        throw new WebsiteArtworkError("Artwork upload is busy. Retry this chunk.", 429);
      }

      if (kind === "session_dead" || kind === "offset") {
        await deps.database.failFile(quoteRequestId, fileId);
        throw new WebsiteArtworkError(
          "This upload can no longer be continued. Start the file again.",
          409
        );
      }

      await deps.database.releaseClaim({
        quoteRequestId,
        fileId,
        kind: "chunk",
        offset,
      });
      throw new WebsiteArtworkError("The artwork could not be saved.", 502);
    }

    const committed = await deps.database.commitChunk({
      quoteRequestId,
      fileId,
      offset,
      bytes: bytes.byteLength,
      sha256: actualHash,
      now,
    });

    if (committed.outcome !== "committed") {
      await deps.database.failFile(quoteRequestId, fileId);
      throw new WebsiteArtworkError(
        "This upload can no longer be continued. Start the file again.",
        409
      );
    }

    return json(
      {
        ok: true,
        uploadedBytes: committed.committedOffset ?? offset + bytes.byteLength,
        totalBytes: file.fileSizeBytes,
      },
      200
    );
  } catch (error) {
    return artworkError(error);
  }
}

export async function handleCompleteWebsiteArtwork(
  request: Request,
  quoteRequestId: string,
  fileId: string,
  deps: WebsiteArtworkDeps = defaultDeps()
) {
  try {
    requireUuid(quoteRequestId, "Quote request id");
    requireUuid(fileId, "File id");
    const now = deps.now();
    const grant = await readGrant(request, deps.secret(), now, "artwork_complete", fileId);
    const existing = await deps.database.readFile(quoteRequestId, fileId);

    if (!existing || existing.fileSizeBytes === null) {
      throw new WebsiteArtworkError("Unauthorized.", 401);
    }

    if (
      !grantAllows(grant, {
        quoteRequestId,
        fileId,
        operation: "finish",
        fileSizeBytes: existing.fileSizeBytes,
      })
    ) {
      throw new WebsiteArtworkError("This upload authorisation does not match this file.", 403);
    }

    const claim = await deps.database.claimFinish({
      quoteRequestId,
      fileId,
      now,
    });

    if (claim.outcome === "already") {
      return json({ ok: true, fileId, uploadStatus: "uploaded", duplicate: true }, 200);
    }

    if (claim.outcome === "incomplete") {
      throw new WebsiteArtworkError(
        "Upload the rest of the file before finishing.",
        409,
        outcomeOffset(claim)
      );
    }

    if (claim.outcome === "busy") {
      throw new WebsiteArtworkError(
        "This file is already being finished.",
        409,
        outcomeOffset(claim)
      );
    }

    if (claim.outcome === "expired" || claim.outcome === "failed" || claim.outcome === "no_session") {
      throw new WebsiteArtworkError(
        "This upload can no longer be continued. Start the file again.",
        409
      );
    }

    if (claim.outcome !== "proceed" || !claim.sessionId || !claim.dropboxPath || !claim.totalBytes) {
      throw new WebsiteArtworkError("Unauthorized.", 401);
    }

    const root = websiteEnquiryRoot();

    if (!isInsideEnquiryRoot(claim.dropboxPath, root)) {
      await deps.database.failFile(quoteRequestId, fileId);
      throw new WebsiteArtworkError("The artwork could not be saved.", 502);
    }

    try {
      const found = await deps.dropbox.findFile(claim.dropboxPath);
      const stored = found && found.size === claim.totalBytes
        ? found
        : await deps.dropbox.finish({
            sessionId: claim.sessionId,
            totalSize: claim.totalBytes,
            dropboxPath: claim.dropboxPath,
          });

      if (stored.size !== claim.totalBytes || !isInsideEnquiryRoot(stored.path, root)) {
        await deps.database.failFile(quoteRequestId, fileId);
        throw new WebsiteArtworkError("The artwork could not be saved.", 502);
      }

      const completed = await deps.database.completeFile({
        quoteRequestId,
        fileId,
        dropboxFileId: stored.id,
        dropboxPath: stored.path,
      });

      if (completed.outcome !== "uploaded" && completed.outcome !== "already") {
        throw new WebsiteArtworkError("The artwork could not be saved.", 502);
      }
    } catch (error) {
      if (error instanceof WebsiteArtworkError) {
        throw error;
      }

      const kind = classifyDropbox(error);
      logArtwork(kind, quoteRequestId, fileId);

      if (kind === "rate_limit") {
        await deps.database.releaseClaim({
          quoteRequestId,
          fileId,
          kind: "finish",
          offset: null,
        });
        throw new WebsiteArtworkError("Artwork upload is busy. Retry this chunk.", 429);
      }

      if (kind === "session_dead" || kind === "offset") {
        await deps.database.failFile(quoteRequestId, fileId);
        throw new WebsiteArtworkError(
          "This upload can no longer be continued. Start the file again.",
          409
        );
      }

      await deps.database.releaseClaim({
        quoteRequestId,
        fileId,
        kind: "finish",
        offset: null,
      });
      throw new WebsiteArtworkError("The artwork could not be saved.", 502);
    }

    return json({ ok: true, fileId, uploadStatus: "uploaded" }, 200);
  } catch (error) {
    return artworkError(error);
  }
}

export async function handleAdminArtworkDownload(
  quoteRequestId: string,
  fileId: string,
  deps: AdminDownloadDeps = defaultAdminDeps()
) {
  try {
    requireUuid(quoteRequestId, "Quote request id");
    requireUuid(fileId, "File id");
    const auth = await deps.verifyAdmin();

    if (!auth.ok) {
      return json({ error: auth.message }, auth.status);
    }

    const file = await deps.readUploadedFile(quoteRequestId, fileId);

    if (!file || !isInsideEnquiryRoot(file.dropboxPath, deps.root())) {
      return json({ error: "Completed artwork was not found." }, 404);
    }

    const url = await deps.temporaryLink(file.dropboxFileId);
    return json({ url }, 200);
  } catch (error) {
    return artworkError(error);
  }
}

function defaultDeps(): WebsiteArtworkDeps {
  return {
    now: () => new Date(),
    database: createSupabaseArtworkDatabase(createAdminClient()),
    dropbox: createDropboxArtworkClient(),
    secret: websiteApiSecret,
  };
}

function defaultAdminDeps(): AdminDownloadDeps {
  return {
    async verifyAdmin() {
      const supabase = await createClient();
      const result = await verifyApprovedAdmin(supabase);
      return result.ok
        ? { ok: true }
        : { ok: false, status: result.status, message: result.message };
    },
    async readUploadedFile(quoteRequestId, fileId) {
      const supabase = await createClient();
      const file = await createSupabaseArtworkDatabase(supabase).readFile(quoteRequestId, fileId);

      if (!file || file.uploadStatus !== "uploaded" || !file.dropboxFileId || !file.dropboxPath) {
        return null;
      }

      return {
        dropboxFileId: file.dropboxFileId,
        dropboxPath: file.dropboxPath,
      };
    },
    temporaryLink: (fileId) => createDropboxArtworkClient().temporaryLink(fileId),
    root: websiteEnquiryRoot,
  };
}
