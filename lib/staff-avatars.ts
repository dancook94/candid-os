import type { SupabaseClient } from "@supabase/supabase-js";

export const STAFF_AVATARS_BUCKET = "staff-avatars";

const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const STAFF_AVATAR_ACCEPT =
  ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";

export type StaffAvatarMetadata = {
  avatar_storage_path: string | null;
  avatar_file_name: string | null;
  avatar_file_type: string | null;
  avatar_file_size: number | null;
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

  return cleaned || "avatar";
}

export function validateStaffAvatarFile(file: File) {
  const extension = getFileExtension(file.name);

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return "Avatar must be PNG, JPG, JPEG, or WEBP.";
  }

  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    return "Avatar file type is not allowed.";
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "Avatar must be 5 MB or smaller.";
  }

  return null;
}

export function buildStaffAvatarStoragePath(
  profileId: string,
  fileName: string,
  timestamp: number = Date.now()
) {
  const sanitizedFileName = sanitizeFileName(fileName);
  return `${profileId}/${timestamp}-${sanitizedFileName}`;
}

export function getStaffInitials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "CC";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function formatStaffAvatarStorageError(error: unknown) {
  if (!error || typeof error !== "object") {
    return "Unable to process staff avatar.";
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

  return "Unable to process staff avatar.";
}

export async function createStaffAvatarSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresInSeconds = 3600
) {
  const { data, error } = await supabase.storage
    .from(STAFF_AVATARS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

export function emptyStaffAvatarMetadata(): StaffAvatarMetadata {
  return {
    avatar_storage_path: null,
    avatar_file_name: null,
    avatar_file_type: null,
    avatar_file_size: null,
  };
}

export async function deleteStaffAvatarObject(
  supabase: SupabaseClient,
  storagePath: string | null | undefined
) {
  if (!storagePath) {
    return;
  }

  const { error } = await supabase.storage
    .from(STAFF_AVATARS_BUCKET)
    .remove([storagePath]);

  if (error) {
    throw error;
  }
}
