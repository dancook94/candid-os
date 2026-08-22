import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildCustomerProofPdfFileName,
  proofArtifactMatchesVersion,
  resolveDropboxFileMetadata,
  resolveProofsFolderPathForJob,
} from "@/lib/proofs/dropbox";
import { ProofError } from "@/lib/proofs/errors";

export type CustomerProofDownloadResolution =
  | "customer_proof"
  | "preflight"
  | "expected_path";

export type ResolvedCustomerProofDownloadFile = {
  id: string | null;
  proof_id: string;
  dropbox_path: string;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  content_hash: string | null;
  resolution: CustomerProofDownloadResolution;
};

type ProofFileRow = {
  id: string;
  proof_id: string;
  file_role: string | null;
  dropbox_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  content_hash: string | null;
};

type PreflightGeneratedRow = {
  generated_dropbox_path: string | null;
  generated_file_name: string | null;
};

export function logProofDownloadDebug(input: {
  proofId: string;
  versionNumber: number;
  jobProofFilesId: string | null;
  fileName: string | null;
  dropboxPath: string | null;
  resolution: CustomerProofDownloadResolution | "missing";
}) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.info("[proofs:download]", {
    proofId: input.proofId,
    versionNumber: input.versionNumber,
    jobProofFilesId: input.jobProofFilesId,
    fileName: input.fileName,
    dropboxPath: input.dropboxPath,
    resolution: input.resolution,
  });
}

async function loadCustomerProofFileRow(
  adminClient: SupabaseClient,
  proofId: string
): Promise<ProofFileRow | null> {
  const { data, error } = await adminClient
    .from("job_proof_files")
    .select(
      "id, proof_id, file_role, dropbox_path, file_name, mime_type, file_size_bytes, content_hash"
    )
    .eq("proof_id", proofId)
    .eq("file_role", "customer_proof")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ProofError(error.message, 500);
  }

  return (data as ProofFileRow | null) ?? null;
}

async function loadPreflightGeneratedRow(
  adminClient: SupabaseClient,
  proofId: string
): Promise<PreflightGeneratedRow | null> {
  const { data, error } = await adminClient
    .from("job_proof_preflight")
    .select("generated_dropbox_path, generated_file_name")
    .eq("proof_id", proofId)
    .maybeSingle();

  if (error) {
    if (error.code === "42703" || error.code === "42P01") {
      return null;
    }
    throw new ProofError(error.message, 500);
  }

  return (data as PreflightGeneratedRow | null) ?? null;
}

async function loadSingleItemReference(
  adminClient: SupabaseClient,
  proofId: string
) {
  const { data, error } = await adminClient
    .from("job_proof_manifest_items")
    .select("production_items(item_reference)")
    .eq("proof_id", proofId);

  if (error) {
    throw new ProofError(error.message, 500);
  }

  const itemReferences = (data ?? [])
    .map(
      (link) =>
        (link.production_items as { item_reference?: string | null } | null)
          ?.item_reference ?? null
    )
    .filter(Boolean) as string[];

  return itemReferences.length === 1 ? itemReferences[0] : null;
}

async function repairCustomerProofFileRecord(
  adminClient: SupabaseClient,
  proofId: string,
  existingId: string | null,
  metadata: {
    dropboxPath: string;
    fileName: string;
    mimeType?: string | null;
    fileSizeBytes?: number | null;
    contentHash?: string | null;
    dropboxFileId?: string | null;
    dropboxRevision?: string | null;
  }
) {
  const payload = {
    file_role: "customer_proof" as const,
    job_file_id: null,
    dropbox_file_id: metadata.dropboxFileId ?? null,
    dropbox_path: metadata.dropboxPath,
    dropbox_revision: metadata.dropboxRevision ?? null,
    file_name: metadata.fileName,
    mime_type: metadata.mimeType ?? "application/pdf",
    file_size_bytes: metadata.fileSizeBytes ?? null,
    content_hash: metadata.contentHash ?? null,
  };

  if (existingId) {
    const { error } = await adminClient
      .from("job_proof_files")
      .update(payload)
      .eq("id", existingId)
      .eq("proof_id", proofId);

    if (error) {
      throw new ProofError(error.message, 500);
    }

    return existingId;
  }

  const { data, error } = await adminClient
    .from("job_proof_files")
    .insert({
      proof_id: proofId,
      ...payload,
    })
    .select("id")
    .single();

  if (error) {
    throw new ProofError(error.message, 500);
  }

  return data.id as string;
}

export async function resolveCustomerProofDownloadFile(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    versionNumber,
    dropboxFolderPath,
    jobReference,
    repairStaleReference = false,
  }: {
    jobId: string;
    proofId: string;
    versionNumber: number;
    dropboxFolderPath: string | null;
    jobReference: string;
    repairStaleReference?: boolean;
  }
): Promise<ResolvedCustomerProofDownloadFile> {
  const [customerProof, preflight, itemReference] = await Promise.all([
    loadCustomerProofFileRow(adminClient, proofId),
    loadPreflightGeneratedRow(adminClient, proofId),
    loadSingleItemReference(adminClient, proofId),
  ]);

  const candidates: Array<{
    resolution: CustomerProofDownloadResolution;
    id: string | null;
    dropbox_path: string;
    file_name: string;
    mime_type: string | null;
    file_size_bytes: number | null;
    content_hash: string | null;
    dropbox_file_id?: string | null;
    dropbox_revision?: string | null;
  }> = [];

  if (customerProof?.dropbox_path) {
    candidates.push({
      resolution: "customer_proof",
      id: customerProof.id,
      dropbox_path: customerProof.dropbox_path,
      file_name: customerProof.file_name ?? "proof.pdf",
      mime_type: customerProof.mime_type,
      file_size_bytes: customerProof.file_size_bytes,
      content_hash: customerProof.content_hash,
    });
  }

  if (preflight?.generated_dropbox_path) {
    candidates.push({
      resolution: "preflight",
      id: customerProof?.id ?? null,
      dropbox_path: preflight.generated_dropbox_path,
      file_name: preflight.generated_file_name ?? "proof.pdf",
      mime_type: "application/pdf",
      file_size_bytes: null,
      content_hash: null,
    });
  }

  const proofsFolderPath = resolveProofsFolderPathForJob(dropboxFolderPath);
  if (proofsFolderPath) {
    const expectedFileName = buildCustomerProofPdfFileName({
      versionNumber,
      itemReference,
      jobReference,
    });
    const expectedPath = `${proofsFolderPath}/${expectedFileName}`;

    try {
      const metadata = await resolveDropboxFileMetadata(expectedPath);
      candidates.push({
        resolution: "expected_path",
        id: customerProof?.id ?? null,
        dropbox_path: metadata.path_lower ?? metadata.path_display,
        file_name: metadata.name,
        mime_type: "application/pdf",
        file_size_bytes: metadata.size,
        content_hash: metadata.content_hash ?? null,
        dropbox_file_id: metadata.id,
        dropbox_revision: metadata.rev,
      });
    } catch {
      // Expected versioned file is not in Dropbox yet.
    }
  }

  const matching = candidates.filter((candidate) =>
    proofArtifactMatchesVersion(
      candidate.file_name,
      candidate.dropbox_path,
      versionNumber
    )
  );

  const selected =
    matching.find((candidate) => candidate.resolution === "customer_proof") ??
    matching.find((candidate) => candidate.resolution === "preflight") ??
    matching.find((candidate) => candidate.resolution === "expected_path") ??
    null;

  if (!selected) {
    logProofDownloadDebug({
      proofId,
      versionNumber,
      jobProofFilesId: customerProof?.id ?? null,
      fileName: customerProof?.file_name ?? null,
      dropboxPath: customerProof?.dropbox_path ?? null,
      resolution: "missing",
    });

    throw new ProofError(
      `Proof v${versionNumber} customer file is not ready to download.`,
      409
    );
  }

  let resolvedId = selected.id;

  const customerProofMatchesVersion = customerProof?.dropbox_path
    ? proofArtifactMatchesVersion(
        customerProof.file_name,
        customerProof.dropbox_path,
        versionNumber
      )
    : false;

  if (repairStaleReference && !customerProofMatchesVersion) {
    resolvedId = await repairCustomerProofFileRecord(
      adminClient,
      proofId,
      customerProof?.id ?? null,
      {
        dropboxPath: selected.dropbox_path,
        fileName: selected.file_name,
        mimeType: selected.mime_type,
        fileSizeBytes: selected.file_size_bytes,
        contentHash: selected.content_hash,
        dropboxFileId: selected.dropbox_file_id ?? null,
        dropboxRevision: selected.dropbox_revision ?? null,
      }
    );
  }

  logProofDownloadDebug({
    proofId,
    versionNumber,
    jobProofFilesId: resolvedId,
    fileName: selected.file_name,
    dropboxPath: selected.dropbox_path,
    resolution: selected.resolution,
  });

  return {
    id: resolvedId,
    proof_id: proofId,
    dropbox_path: selected.dropbox_path,
    file_name: selected.file_name,
    mime_type: selected.mime_type,
    file_size_bytes: selected.file_size_bytes,
    content_hash: selected.content_hash,
    resolution: selected.resolution,
  };
}
