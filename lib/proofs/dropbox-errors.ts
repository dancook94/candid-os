import { DropboxError } from "@/lib/dropbox/client";
import { ProofError } from "@/lib/proofs/errors";

export type DropboxProofOperation =
  | "download_source_artwork"
  | "upload_generated_proof"
  | "ensure_proofs_folder"
  | "resolve_metadata";

export function isDropboxPathNotFoundError(error: unknown) {
  return error instanceof DropboxError && /path\/not_found/i.test(error.message);
}

export function logDropboxProofDebug(
  event: string,
  payload: Record<string, unknown>
) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.info("[proofs:dropbox]", event, payload);
}

export function mapDropboxErrorToProofError(
  error: unknown,
  context: {
    operation: DropboxProofOperation;
    path: string;
    fileName?: string | null;
    dropboxApi?: string;
  }
): ProofError {
  if (error instanceof ProofError) {
    return error;
  }

  logDropboxProofDebug("dropbox_operation_failed", {
    operation: context.operation,
    path: context.path,
    fileName: context.fileName ?? null,
    dropboxApi: context.dropboxApi ?? null,
    error: error instanceof Error ? error.message : String(error),
  });

  if (!(error instanceof DropboxError)) {
    return new ProofError("Dropbox operation failed.", 502);
  }

  const summary = error.message.toLowerCase();

  if (summary.includes("path/not_found")) {
    if (context.operation === "download_source_artwork") {
      return new ProofError(
        context.fileName
          ? `Source artwork "${context.fileName}" could not be found in Dropbox. Re-attach artwork for this proof version.`
          : "Source artwork could not be found in Dropbox. Re-attach artwork for this proof version.",
        404
      );
    }

    if (
      context.operation === "upload_generated_proof" ||
      context.operation === "ensure_proofs_folder"
    ) {
      return new ProofError(
        "The job's 03 Proofs folder could not be found in Dropbox.",
        404
      );
    }

    return new ProofError(
      "The requested Dropbox path could not be found.",
      404
    );
  }

  if (summary.includes("not_found")) {
    return new ProofError(
      context.operation === "download_source_artwork"
        ? "Source artwork could not be found in Dropbox."
        : "The requested Dropbox item could not be found.",
      404
    );
  }

  return new ProofError("Dropbox operation failed.", error.status >= 500 ? 502 : 400);
}

export async function runDropboxProofOperation<T>(
  context: {
    operation: DropboxProofOperation;
    path: string;
    fileName?: string | null;
    dropboxApi?: string;
  },
  action: () => Promise<T>
) {
  try {
    return await action();
  } catch (error) {
    throw mapDropboxErrorToProofError(error, context);
  }
}
