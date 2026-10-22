import { randomUUID } from "node:crypto";

import type {
  ArtworkDatabase,
  ArtworkEnquiry,
  ArtworkFileRecord,
  ArtworkOutcome,
} from "@/lib/quote-request/website-artwork-db";

type StoredFile = {
  id: string;
  quoteRequestId: string;
  originalFileName: string;
  dropboxFileId: string | null;
  dropboxPath: string | null;
  fileSizeBytes: number;
  mimeType: string | null;
  uploadStatus: "pending" | "uploaded" | "failed";
  createdAt: string;
  sessionId: string | null;
  offset: number;
  sessionExpiresAt: string | null;
  claimExpiresAt: string | null;
  claimOffset: number | null;
  claimBytes: number | null;
  claimKind: "chunk" | "finish" | null;
  lastOffset: number | null;
  lastBytes: number | null;
  lastSha: string | null;
};

function suffixedName(name: string, attempt: number) {
  if (attempt <= 1) {
    return name;
  }

  const match = name.match(/^(.*)\.([A-Za-z0-9]+)$/);
  return match ? `${match[1]}_${attempt}.${match[2]}` : `${name}_${attempt}`;
}

function toRecord(file: StoredFile): ArtworkFileRecord {
  return {
    id: file.id,
    quoteRequestId: file.quoteRequestId,
    originalFileName: file.originalFileName,
    dropboxFileId: file.dropboxFileId,
    dropboxPath: file.dropboxPath,
    fileSizeBytes: file.fileSizeBytes,
    mimeType: file.mimeType,
    uploadStatus: file.uploadStatus,
    createdAt: file.createdAt,
    dropboxUploadSessionId: file.sessionId,
    uploadSessionOffset: file.offset,
    sessionExpiresAt: file.sessionExpiresAt,
  };
}

function clearClaim(file: StoredFile) {
  file.claimExpiresAt = null;
  file.claimOffset = null;
  file.claimBytes = null;
  file.claimKind = null;
}

function fail(file: StoredFile) {
  if (file.uploadStatus === "uploaded") {
    return;
  }

  file.uploadStatus = "failed";
  file.sessionId = null;
  clearClaim(file);
}

export function createMemoryArtworkDatabase() {
  const enquiries = new Map<string, ArtworkEnquiry>();
  const files = new Map<string, StoredFile>();
  let tail = Promise.resolve();

  function lock<T>(fn: () => T): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function expire(quoteRequestId: string, now: Date) {
    for (const file of files.values()) {
      if (file.quoteRequestId !== quoteRequestId || file.uploadStatus !== "pending") {
        continue;
      }

      const sessionExpired =
        file.sessionExpiresAt !== null && new Date(file.sessionExpiresAt).getTime() <= now.getTime();
      const abandoned =
        file.sessionId === null &&
        new Date(file.createdAt).getTime() <= now.getTime() - 15 * 60 * 1000;

      if (sessionExpired || abandoned) {
        fail(file);
      }
    }
  }

  const database: ArtworkDatabase = {
    async getEnquiry(quoteRequestId) {
      return enquiries.get(quoteRequestId) ?? null;
    },

    async readFile(quoteRequestId, fileId) {
      const file = files.get(fileId);
      if (!file || file.quoteRequestId !== quoteRequestId) {
        return null;
      }

      return toRecord(file);
    },

    reserveFile(input) {
      return lock(() => {
        const enquiry = enquiries.get(input.quoteRequestId);

        if (
          !enquiry ||
          enquiry.source !== "website" ||
          enquiry.externalSubmissionId !== input.externalSubmissionId
        ) {
          return { outcome: "not_found" };
        }

        if (input.fileSizeBytes <= 0 || input.fileSizeBytes > 524288000) {
          return { outcome: "too_large" };
        }

        if (
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(input.storedFileName) ||
          input.folderPath.includes("..")
        ) {
          return { outcome: "invalid_path" };
        }

        expire(input.quoteRequestId, input.now);
        const active = [...files.values()].filter(
          (file) => file.quoteRequestId === input.quoteRequestId && file.uploadStatus !== "failed"
        );

        if (active.length >= 10) {
          return { outcome: "file_limit" };
        }

        let chosen: string | null = null;

        for (let attempt = 1; attempt <= 20; attempt += 1) {
          const name = suffixedName(input.storedFileName, attempt);
          const path = `${input.folderPath}/${name}`;
          const taken = active.some((file) => file.dropboxPath === path);

          if (!taken) {
            chosen = path;
            break;
          }
        }

        if (!chosen) {
          return { outcome: "name_taken" };
        }

        const file: StoredFile = {
          id: randomUUID(),
          quoteRequestId: input.quoteRequestId,
          originalFileName: input.originalFileName.trim(),
          dropboxFileId: null,
          dropboxPath: chosen,
          fileSizeBytes: input.fileSizeBytes,
          mimeType: input.mimeType,
          uploadStatus: "pending",
          createdAt: input.now.toISOString(),
          sessionId: null,
          offset: 0,
          sessionExpiresAt: null,
          claimExpiresAt: null,
          claimOffset: null,
          claimBytes: null,
          claimKind: null,
          lastOffset: null,
          lastBytes: null,
          lastSha: null,
        };
        files.set(file.id, file);

        return { outcome: "reserved", fileId: file.id, dropboxPath: chosen } satisfies ArtworkOutcome;
      });
    },

    attachSession(input) {
      return lock(() => {
        const file = files.get(input.fileId);

        if (
          !file ||
          file.quoteRequestId !== input.quoteRequestId ||
          file.uploadStatus !== "pending" ||
          file.sessionId
        ) {
          return { outcome: "not_pending" };
        }

        file.sessionId = input.sessionId;
        file.sessionExpiresAt = new Date(input.now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        return { outcome: "attached" };
      });
    },

    failFile(quoteRequestId, fileId) {
      return lock(() => {
        const file = files.get(fileId);

        if (!file || file.quoteRequestId !== quoteRequestId) {
          return { outcome: "not_found" };
        }

        if (file.uploadStatus === "uploaded") {
          return { outcome: "uploaded" };
        }

        fail(file);
        return { outcome: "failed" };
      });
    },

    claimChunk(input) {
      return lock(() => {
        const file = files.get(input.fileId);

        if (!file || file.quoteRequestId !== input.quoteRequestId) {
          return { outcome: "not_found" };
        }

        if (file.uploadStatus === "uploaded") {
          return { outcome: "already_uploaded" };
        }

        if (file.uploadStatus === "failed") {
          return { outcome: "failed" };
        }

        if (file.sessionExpiresAt && new Date(file.sessionExpiresAt).getTime() <= input.now.getTime()) {
          fail(file);
          return { outcome: "expired" };
        }

        if (!file.sessionId) {
          fail(file);
          return { outcome: "no_session" };
        }

        if (
          file.lastOffset !== null &&
          input.offset === file.lastOffset &&
          input.bytes === file.lastBytes &&
          input.sha256 === file.lastSha &&
          file.offset === input.offset + input.bytes
        ) {
          return { outcome: "duplicate", committedOffset: file.offset };
        }

        if (input.offset < file.offset) {
          return { outcome: "conflict", committedOffset: file.offset };
        }

        if (input.offset > file.offset) {
          return { outcome: "gap", committedOffset: file.offset };
        }

        if (input.offset + input.bytes > file.fileSizeBytes) {
          return { outcome: "exceeds", committedOffset: file.offset };
        }

        if (file.claimExpiresAt && new Date(file.claimExpiresAt).getTime() > input.now.getTime()) {
          return { outcome: "busy", committedOffset: file.offset };
        }

        file.claimExpiresAt = new Date(input.now.getTime() + 2 * 60 * 1000).toISOString();
        file.claimOffset = input.offset;
        file.claimBytes = input.bytes;
        file.claimKind = "chunk";

        return {
          outcome: "proceed",
          sessionId: file.sessionId,
          committedOffset: file.offset,
        };
      });
    },

    commitChunk(input) {
      return lock(() => {
        const file = files.get(input.fileId);

        if (!file || file.quoteRequestId !== input.quoteRequestId) {
          return { outcome: "not_found" };
        }

        if (
          file.claimKind !== "chunk" ||
          file.claimOffset !== input.offset ||
          file.claimBytes !== input.bytes ||
          file.offset !== input.offset ||
          !file.claimExpiresAt ||
          new Date(file.claimExpiresAt).getTime() <= input.now.getTime()
        ) {
          return { outcome: "lost_claim", committedOffset: file.offset };
        }

        file.offset = input.offset + input.bytes;
        file.lastOffset = input.offset;
        file.lastBytes = input.bytes;
        file.lastSha = input.sha256;
        clearClaim(file);
        return { outcome: "committed", committedOffset: file.offset };
      });
    },

    async releaseClaim(input) {
      await lock(() => {
        const file = files.get(input.fileId);

        if (!file || file.quoteRequestId !== input.quoteRequestId || file.uploadStatus !== "pending") {
          return;
        }

        if (file.claimKind !== input.kind) {
          return;
        }

        if (input.kind === "chunk" && file.claimOffset !== input.offset) {
          return;
        }

        clearClaim(file);
      });
    },

    claimFinish(input) {
      return lock(() => {
        const file = files.get(input.fileId);

        if (!file || file.quoteRequestId !== input.quoteRequestId) {
          return { outcome: "not_found" };
        }

        if (file.uploadStatus === "uploaded") {
          return {
            outcome: "already",
            dropboxFileId: file.dropboxFileId,
            dropboxPath: file.dropboxPath,
          };
        }

        if (file.uploadStatus === "failed") {
          return { outcome: "failed" };
        }

        if (file.sessionExpiresAt && new Date(file.sessionExpiresAt).getTime() <= input.now.getTime()) {
          fail(file);
          return { outcome: "expired" };
        }

        if (!file.sessionId || !file.dropboxPath) {
          return { outcome: "no_session" };
        }

        if (file.offset !== file.fileSizeBytes) {
          return { outcome: "incomplete", committedOffset: file.offset };
        }

        if (file.claimExpiresAt && new Date(file.claimExpiresAt).getTime() > input.now.getTime()) {
          return { outcome: "busy", committedOffset: file.offset };
        }

        file.claimExpiresAt = new Date(input.now.getTime() + 2 * 60 * 1000).toISOString();
        file.claimKind = "finish";
        file.claimOffset = null;
        file.claimBytes = null;

        return {
          outcome: "proceed",
          sessionId: file.sessionId,
          dropboxPath: file.dropboxPath,
          totalBytes: file.fileSizeBytes,
        };
      });
    },

    completeFile(input) {
      return lock(() => {
        const file = files.get(input.fileId);

        if (!file || file.quoteRequestId !== input.quoteRequestId) {
          return { outcome: "not_found" };
        }

        if (file.uploadStatus === "uploaded") {
          return { outcome: "already" };
        }

        if (file.uploadStatus !== "pending" || file.claimKind !== "finish") {
          return { outcome: "not_ready" };
        }

        file.uploadStatus = "uploaded";
        file.dropboxFileId = input.dropboxFileId;
        file.dropboxPath = input.dropboxPath;
        file.sessionId = null;
        clearClaim(file);
        return { outcome: "uploaded" };
      });
    },

    async expireEnquiry(quoteRequestId, now) {
      await lock(() => expire(quoteRequestId, now));
    },
  };

  return { database, enquiries, files };
}
