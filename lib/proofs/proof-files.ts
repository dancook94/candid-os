import type { ProofFileRole } from "@/lib/proofs/constants";
import { getFileExtension } from "@/lib/proofs/file-validation";
import type { JobProofFileView } from "@/lib/proofs/types";

export function normalizeProofFileRole(
  role: string | null | undefined
): ProofFileRole {
  return role === "source_artwork" ? "source_artwork" : "customer_proof";
}

export function getProofFileByRole(
  files: JobProofFileView[],
  role: ProofFileRole
): JobProofFileView | null {
  return files.find((file) => normalizeProofFileRole(file.file_role) === role) ?? null;
}

export function getSourceArtworkFile(
  files: JobProofFileView[]
): JobProofFileView | null {
  return getProofFileByRole(files, "source_artwork");
}

export function getCustomerProofFile(
  files: JobProofFileView[]
): JobProofFileView | null {
  return getProofFileByRole(files, "customer_proof");
}

export function hasBrandedProofWorkflow(files: JobProofFileView[]) {
  return Boolean(getSourceArtworkFile(files));
}

export function hasGeneratorEligibleSourceArtwork(files: JobProofFileView[]) {
  const source = getSourceArtworkFile(files);
  if (!source?.dropbox_path) {
    return false;
  }

  const extension = getFileExtension(source.file_name);
  return ["pdf", "jpg", "jpeg", "png"].includes(extension);
}

export function hasGeneratedCustomerProof(files: JobProofFileView[]) {
  const customerProof = getCustomerProofFile(files);
  if (!customerProof?.dropbox_path) {
    return false;
  }

  return (
    customerProof.mime_type === "application/pdf" ||
    getFileExtension(customerProof.file_name) === "pdf"
  );
}
