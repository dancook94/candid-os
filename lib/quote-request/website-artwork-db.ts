import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createDropboxFolder,
  DropboxError,
  getDropboxMetadata,
  getDropboxTemporaryLink,
  isDropboxConfigured,
} from "@/lib/dropbox/client";
import {
  appendDropboxUploadSession,
  finishDropboxUploadSession,
  startDropboxUploadSession,
} from "@/lib/dropbox/upload-session";

import { WebsiteArtworkError } from "@/lib/quote-request/website-artwork-policy";

export type ArtworkEnquiry = {
  id: string;
  source: string;
  externalSubmissionId: string | null;
  companyName: string | null;
  projectName: string | null;
  createdAt: string;
};

export type ArtworkFileRecord = {
  id: string;
  quoteRequestId: string;
  originalFileName: string;
  dropboxFileId: string | null;
  dropboxPath: string | null;
  fileSizeBytes: number | null;
  mimeType: string | null;
  uploadStatus: "pending" | "uploaded" | "failed";
  createdAt: string;
  dropboxUploadSessionId: string | null;
  uploadSessionOffset: number;
  sessionExpiresAt: string | null;
};

export type ArtworkOutcome = {
  outcome: string;
  fileId?: string;
  dropboxPath?: string | null;
  dropboxFileId?: string | null;
  sessionId?: string | null;
  committedOffset?: number;
  totalBytes?: number;
};

export type ArtworkDatabase = {
  getEnquiry(quoteRequestId: string): Promise<ArtworkEnquiry | null>;
  readFile(quoteRequestId: string, fileId: string): Promise<ArtworkFileRecord | null>;
  reserveFile(input: {
    quoteRequestId: string;
    externalSubmissionId: string;
    originalFileName: string;
    storedFileName: string;
    folderPath: string;
    fileSizeBytes: number;
    mimeType: string | null;
    now: Date;
  }): Promise<ArtworkOutcome>;
  attachSession(input: {
    quoteRequestId: string;
    fileId: string;
    sessionId: string;
    now: Date;
  }): Promise<ArtworkOutcome>;
  failFile(quoteRequestId: string, fileId: string): Promise<ArtworkOutcome>;
  claimChunk(input: {
    quoteRequestId: string;
    fileId: string;
    offset: number;
    bytes: number;
    sha256: string;
    now: Date;
  }): Promise<ArtworkOutcome>;
  commitChunk(input: {
    quoteRequestId: string;
    fileId: string;
    offset: number;
    bytes: number;
    sha256: string;
    now: Date;
  }): Promise<ArtworkOutcome>;
  releaseClaim(input: {
    quoteRequestId: string;
    fileId: string;
    kind: "chunk" | "finish";
    offset: number | null;
  }): Promise<void>;
  claimFinish(input: {
    quoteRequestId: string;
    fileId: string;
    now: Date;
  }): Promise<ArtworkOutcome>;
  completeFile(input: {
    quoteRequestId: string;
    fileId: string;
    dropboxFileId: string;
    dropboxPath: string;
  }): Promise<ArtworkOutcome>;
  expireEnquiry(quoteRequestId: string, now: Date): Promise<void>;
};

export type StoredArtwork = {
  id: string;
  path: string;
  size: number;
};

export type WebsiteArtworkDropbox = {
  configured: () => boolean;
  createFolder: (path: string) => Promise<void>;
  startSession: () => Promise<string>;
  append: (sessionId: string, offset: number, chunk: Uint8Array) => Promise<void>;
  finish: (input: {
    sessionId: string;
    totalSize: number;
    dropboxPath: string;
  }) => Promise<StoredArtwork>;
  findFile: (path: string) => Promise<StoredArtwork | null>;
  temporaryLink: (fileId: string) => Promise<string>;
};

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }

  return undefined;
}

function asOutcome(value: unknown): ArtworkOutcome {
  if (!value || typeof value !== "object" || !("outcome" in value)) {
    throw new WebsiteArtworkError("The artwork could not be saved.", 500);
  }

  const row = value as Record<string, unknown>;
  return {
    outcome: String(row.outcome),
    fileId: typeof row.fileId === "string" ? row.fileId : undefined,
    dropboxPath: typeof row.dropboxPath === "string" ? row.dropboxPath : null,
    dropboxFileId: typeof row.dropboxFileId === "string" ? row.dropboxFileId : null,
    sessionId: typeof row.sessionId === "string" ? row.sessionId : null,
    committedOffset: asNumber(row.committedOffset),
    totalBytes: asNumber(row.totalBytes),
  };
}

async function callRpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>
) {
  const { data, error } = await client.rpc(name, args);

  if (error) {
    throw new WebsiteArtworkError("The artwork could not be saved.", 500);
  }

  return asOutcome(data);
}

function mapFile(row: Record<string, unknown> | null): ArtworkFileRecord | null {
  if (!row || typeof row.id !== "string") {
    return null;
  }

  const status = row.upload_status;
  if (status !== "pending" && status !== "uploaded" && status !== "failed") {
    return null;
  }

  return {
    id: row.id,
    quoteRequestId: String(row.quote_request_id),
    originalFileName: String(row.original_file_name),
    dropboxFileId: typeof row.dropbox_file_id === "string" ? row.dropbox_file_id : null,
    dropboxPath: typeof row.dropbox_path === "string" ? row.dropbox_path : null,
    fileSizeBytes: asNumber(row.file_size_bytes) ?? null,
    mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
    uploadStatus: status,
    createdAt: String(row.created_at),
    dropboxUploadSessionId:
      typeof row.dropbox_upload_session_id === "string" ? row.dropbox_upload_session_id : null,
    uploadSessionOffset: asNumber(row.upload_session_offset) ?? 0,
    sessionExpiresAt:
      typeof row.session_expires_at === "string" ? row.session_expires_at : null,
  };
}

export function createSupabaseArtworkDatabase(client: SupabaseClient): ArtworkDatabase {
  return {
    async getEnquiry(quoteRequestId) {
      const { data, error } = await client
        .from("quote_requests")
        .select(
          "id, source, external_submission_id, submitter_company_name, project_name, created_at"
        )
        .eq("id", quoteRequestId)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return {
        id: data.id,
        source: data.source,
        externalSubmissionId: data.external_submission_id,
        companyName: data.submitter_company_name,
        projectName: data.project_name,
        createdAt: data.created_at,
      };
    },

    async readFile(quoteRequestId, fileId) {
      const { data, error } = await client
        .from("quote_request_dropbox_files")
        .select(
          "id, quote_request_id, original_file_name, dropbox_file_id, dropbox_path, file_size_bytes, mime_type, upload_status, created_at, dropbox_upload_session_id, upload_session_offset, session_expires_at"
        )
        .eq("id", fileId)
        .eq("quote_request_id", quoteRequestId)
        .maybeSingle();

      if (error) {
        return null;
      }

      return mapFile(data);
    },

    reserveFile(input) {
      return callRpc(client, "quote_request_dropbox_reserve_file", {
        p_quote_request_id: input.quoteRequestId,
        p_external_submission_id: input.externalSubmissionId,
        p_original_file_name: input.originalFileName,
        p_stored_file_name: input.storedFileName,
        p_folder_path: input.folderPath,
        p_file_size_bytes: input.fileSizeBytes,
        p_mime_type: input.mimeType,
        p_now: input.now.toISOString(),
      });
    },

    attachSession(input) {
      return callRpc(client, "quote_request_dropbox_attach_session", {
        p_file_id: input.fileId,
        p_quote_request_id: input.quoteRequestId,
        p_session_id: input.sessionId,
        p_now: input.now.toISOString(),
      });
    },

    failFile(quoteRequestId, fileId) {
      return callRpc(client, "quote_request_dropbox_fail_file", {
        p_file_id: fileId,
        p_quote_request_id: quoteRequestId,
      });
    },

    claimChunk(input) {
      return callRpc(client, "quote_request_dropbox_claim_chunk", {
        p_file_id: input.fileId,
        p_quote_request_id: input.quoteRequestId,
        p_offset: input.offset,
        p_bytes: input.bytes,
        p_sha256: input.sha256,
        p_now: input.now.toISOString(),
      });
    },

    commitChunk(input) {
      return callRpc(client, "quote_request_dropbox_commit_chunk", {
        p_file_id: input.fileId,
        p_quote_request_id: input.quoteRequestId,
        p_offset: input.offset,
        p_bytes: input.bytes,
        p_sha256: input.sha256,
        p_now: input.now.toISOString(),
      });
    },

    async releaseClaim(input) {
      await callRpc(client, "quote_request_dropbox_release_claim", {
        p_file_id: input.fileId,
        p_quote_request_id: input.quoteRequestId,
        p_kind: input.kind,
        p_offset: input.offset,
      });
    },

    claimFinish(input) {
      return callRpc(client, "quote_request_dropbox_claim_finish", {
        p_file_id: input.fileId,
        p_quote_request_id: input.quoteRequestId,
        p_now: input.now.toISOString(),
      });
    },

    completeFile(input) {
      return callRpc(client, "quote_request_dropbox_complete_file", {
        p_file_id: input.fileId,
        p_quote_request_id: input.quoteRequestId,
        p_dropbox_file_id: input.dropboxFileId,
        p_dropbox_path: input.dropboxPath,
      });
    },

    async expireEnquiry(quoteRequestId, now) {
      await callRpc(client, "quote_request_dropbox_expire_enquiry", {
        p_quote_request_id: quoteRequestId,
        p_now: now.toISOString(),
      });
    },
  };
}

export function createDropboxArtworkClient(): WebsiteArtworkDropbox {
  return {
    configured: isDropboxConfigured,
    async createFolder(path) {
      await createDropboxFolder(path);
    },
    async startSession() {
      const session = await startDropboxUploadSession();

      if (!session.session_id) {
        throw new DropboxError("Dropbox did not start an upload.", 502);
      }

      return session.session_id;
    },
    async append(sessionId, offset, chunk) {
      const copy = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength
        ? chunk
        : chunk.slice();
      await appendDropboxUploadSession(sessionId, offset, copy.buffer as ArrayBuffer);
    },
    async finish(input) {
      const metadata = await finishDropboxUploadSession(input);
      return {
        id: metadata.id,
        path: metadata.path_lower || metadata.path_display,
        size: metadata.size,
      };
    },
    async findFile(path) {
      try {
        const metadata = await getDropboxMetadata(path);
        const file = metadata.metadata;

        if (!file || !("size" in file) || !file.id) {
          return null;
        }

        return {
          id: file.id,
          path: "path_lower" in file && file.path_lower ? file.path_lower : file.path_display,
          size: file.size,
        };
      } catch (error) {
        if (error instanceof DropboxError && /not_found/i.test(error.message)) {
          return null;
        }

        throw error;
      }
    },
    temporaryLink: getDropboxTemporaryLink,
  };
}
