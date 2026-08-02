import type { SupabaseClient } from "@supabase/supabase-js";

export const COMPANY_LOGOS_BUCKET = "company-logos";

const ALLOWED_EXTENSIONS = new Set(["svg", "png", "jpg", "jpeg", "webp"]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const COMPANY_LOGO_ACCEPT =
  ".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp";

export type CompanyLogoMetadata = {
  logo_storage_path: string | null;
  logo_file_name: string | null;
  logo_file_type: string | null;
  logo_file_size: number | null;
};

function getFileExtension(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() ?? "" : "";
}

export function sanitizeFileName(fileName: string) {
  const cleaned = fileName
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .trim()
    .toLowerCase();

  return cleaned || "logo";
}

export function validateCompanyLogoFile(file: File) {
  const extension = getFileExtension(file.name);

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return "Logo must be SVG, PNG, JPG, JPEG, or WEBP.";
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "Logo must be 5 MB or smaller.";
  }

  return null;
}

export function buildCompanyLogoStoragePath(
  companyId: string,
  fileName: string,
  timestamp: number = Date.now()
) {
  const sanitizedFileName = sanitizeFileName(fileName);
  return `${companyId}/${timestamp}-${sanitizedFileName}`;
}

export function formatSupabaseStorageError(error: unknown) {
  if (!error || typeof error !== "object") {
    return "Unable to process company logo.";
  }

  const parts = [
    "message" in error && typeof error.message === "string"
      ? error.message
      : null,
    "details" in error && typeof error.details === "string"
      ? error.details
      : null,
    "hint" in error && typeof error.hint === "string" ? error.hint : null,
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(" — ");
  }

  return "Unable to process company logo.";
}

export function getCompanyInitials(companyName: string) {
  const parts = companyName.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "CO";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export async function createCompanyLogoSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresInSeconds = 3600
) {
  const { data, error } = await supabase.storage
    .from(COMPANY_LOGOS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

export async function uploadCompanyLogo(
  supabase: SupabaseClient,
  {
    file,
    companyId,
  }: {
    file: File;
    companyId: string;
  }
) {
  const validationError = validateCompanyLogoFile(file);

  if (validationError) {
    throw new Error(validationError);
  }

  const storagePath = buildCompanyLogoStoragePath(companyId, file.name);

  const { error: uploadError } = await supabase.storage
    .from(COMPANY_LOGOS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  return {
    logo_storage_path: storagePath,
    logo_file_name: file.name,
    logo_file_type: file.type || "application/octet-stream",
    logo_file_size: file.size,
  } satisfies CompanyLogoMetadata;
}

export async function deleteCompanyLogoObject(
  supabase: SupabaseClient,
  storagePath: string | null | undefined
) {
  if (!storagePath) {
    return;
  }

  const { error } = await supabase.storage
    .from(COMPANY_LOGOS_BUCKET)
    .remove([storagePath]);

  if (error) {
    throw error;
  }
}

export function emptyCompanyLogoMetadata(): CompanyLogoMetadata {
  return {
    logo_storage_path: null,
    logo_file_name: null,
    logo_file_type: null,
    logo_file_size: null,
  };
}
