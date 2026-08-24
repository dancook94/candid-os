import type { SupabaseClient } from "@supabase/supabase-js";

import {
  proofArtifactMatchesVersion,
  resolveDropboxFileMetadata,
} from "@/lib/proofs/dropbox";
import { ProofError } from "@/lib/proofs/errors";
import { normalizeDropboxApiPath } from "@/lib/proofs/file-validation";
import { isDropboxPathNotFoundError } from "@/lib/proofs/dropbox-errors";

const EDITABLE_DRAFT_STATUSES = ["draft", "internal_review"] as const;

const LOCKED_PROOF_STATUSES = [
  "ready_to_send",
  "sent",
  "viewed",
  "changes_requested",
  "approved",
] as const;

export type GeneratedProofUploadStrategy =
  | { action: "upload_new" }
  | {
      action: "overwrite";
      dropboxPath: string;
      targetFileName: string;
    }
  | {
      action: "recognize_existing";
      dropboxPath: string;
      targetFileName: string;
    }
  | { action: "conflict"; message: string };

export function isEditableDraftForRegeneration(status: string) {
  return EDITABLE_DRAFT_STATUSES.includes(
    status as (typeof EDITABLE_DRAFT_STATUSES)[number]
  );
}

export function isLockedProofVersion(status: string) {
  return LOCKED_PROOF_STATUSES.includes(
    status as (typeof LOCKED_PROOF_STATUSES)[number]
  );
}

export function versionedProofFileMatchesProof(input: {
  fileName: string;
  dropboxPath: string;
  versionNumber: number;
}) {
  return proofArtifactMatchesVersion(
    input.fileName,
    input.dropboxPath,
    input.versionNumber
  );
}

async function dropboxFileExists(dropboxPath: string) {
  try {
    await resolveDropboxFileMetadata(dropboxPath);
    return true;
  } catch (error) {
    if (error instanceof ProofError && error.status === 404) {
      return false;
    }
    if (isDropboxPathNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function findOtherProofOwningCustomerPath(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    dropboxPath,
  }: {
    jobId: string;
    proofId: string;
    dropboxPath: string;
  }
) {
  const normalizedTarget = normalizeDropboxApiPath(dropboxPath).toLowerCase();

  const { data, error } = await adminClient
    .from("job_proof_files")
    .select(
      "proof_id, file_name, dropbox_path, job_proofs!inner(id, job_id, version_number, status)"
    )
    .eq("file_role", "customer_proof")
    .neq("proof_id", proofId);

  if (error) {
    throw new ProofError(error.message, 500);
  }

  return (data ?? []).find((row) => {
    const proofRaw = row.job_proofs as
      | {
          id: string;
          job_id: string;
          version_number: number;
          status: string;
        }
      | {
          id: string;
          job_id: string;
          version_number: number;
          status: string;
        }[]
      | null;

    const proof = Array.isArray(proofRaw) ? proofRaw[0] : proofRaw;

    if (!proof || proof.job_id !== jobId) {
      return false;
    }

    const normalizedPath = normalizeDropboxApiPath(
      (row.dropbox_path as string | null) ?? ""
    ).toLowerCase();

    return normalizedPath === normalizedTarget;
  });
}

export async function resolveGeneratedProofUploadStrategy(
  adminClient: SupabaseClient,
  input: {
    jobId: string;
    proofId: string;
    proofStatus: string;
    versionNumber: number;
    targetFileName: string;
    dropboxPath: string;
    hasDbCustomerProof: boolean;
    allowRegeneration: boolean;
  }
): Promise<GeneratedProofUploadStrategy> {
  const normalizedPath = normalizeDropboxApiPath(input.dropboxPath);
  const existsInDropbox = await dropboxFileExists(normalizedPath);

  if (!existsInDropbox) {
    return { action: "upload_new" };
  }

  const matchesThisVersion = versionedProofFileMatchesProof({
    fileName: input.targetFileName,
    dropboxPath: normalizedPath,
    versionNumber: input.versionNumber,
  });

  if (!matchesThisVersion) {
    const otherOwner = await findOtherProofOwningCustomerPath(adminClient, {
      jobId: input.jobId,
      proofId: input.proofId,
      dropboxPath: normalizedPath,
    });

    if (otherOwner) {
      const ownerProofRaw = otherOwner.job_proofs as
        | { version_number: number }
        | { version_number: number }[]
        | null;
      const ownerProof = Array.isArray(ownerProofRaw) ? ownerProofRaw[0] : ownerProofRaw;
      return {
        action: "conflict",
        message: `Proof v${input.versionNumber} file "${input.targetFileName}" already exists in Dropbox and belongs to another proof version (v${ownerProof?.version_number ?? "?"}). Resolve the inconsistency before generating again.`,
      };
    }

    return {
      action: "conflict",
      message: `Proof v${input.versionNumber} file "${input.targetFileName}" already exists in Dropbox but does not match this proof version. Resolve the inconsistency before generating again.`,
    };
  }

  if (isLockedProofVersion(input.proofStatus)) {
    return {
      action: "conflict",
      message: `Proof v${input.versionNumber} file "${input.targetFileName}" already exists in Dropbox. Create a revised proof to generate the next version instead of overwriting a locked proof.`,
    };
  }

  if (!isEditableDraftForRegeneration(input.proofStatus)) {
    return {
      action: "conflict",
      message: `Proof v${input.versionNumber} file "${input.targetFileName}" already exists in Dropbox and this proof version cannot be regenerated safely.`,
    };
  }

  if (!input.allowRegeneration) {
    return {
      action: "recognize_existing",
      dropboxPath: normalizedPath,
      targetFileName: input.targetFileName,
    };
  }

  return {
    action: "overwrite",
    dropboxPath: normalizedPath,
    targetFileName: input.targetFileName,
  };
}

export async function fetchDropboxGeneratedProofMetadata(dropboxPath: string) {
  return resolveDropboxFileMetadata(normalizeDropboxApiPath(dropboxPath));
}
