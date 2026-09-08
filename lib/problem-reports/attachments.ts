import type { SupabaseClient } from "@supabase/supabase-js";

export const PROBLEM_REPORT_FILES_BUCKET = "problem-report-files";

const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "pdf"]);
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "application/pdf",
]);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const PROBLEM_REPORT_ATTACHMENT_ACCEPT =
  ".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf";

function getFileExtension(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() ?? "" : "";
}

export function sanitizeProblemReportFileName(fileName: string) {
  const cleaned = fileName
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .trim()
    .toLowerCase();

  return cleaned || "attachment";
}

export function validateProblemReportAttachmentFile(file: File) {
  const extension = getFileExtension(file.name);

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return "Attachment must be PNG, JPG, JPEG, or PDF.";
  }

  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    return "Attachment file type is not allowed.";
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "Attachment must be 10 MB or smaller.";
  }

  return null;
}

export function buildProblemReportStoragePath(
  reportId: string,
  fileName: string,
  timestamp: number = Date.now()
) {
  return `${reportId}/${timestamp}-${sanitizeProblemReportFileName(fileName)}`;
}

export async function createProblemReportAttachmentSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresInSeconds = 60
) {
  const { data, error } = await supabase.storage
    .from(PROBLEM_REPORT_FILES_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return { signedUrl: null, error: error?.message ?? "Unable to create download link." };
  }

  return { signedUrl: data.signedUrl, error: null };
}

export async function uploadProblemReportAttachment(
  supabase: SupabaseClient,
  input: {
    reportId: string;
    uploadedBy: string;
    file: File;
  }
) {
  const validationError = validateProblemReportAttachmentFile(input.file);

  if (validationError) {
    return { ok: false as const, message: validationError };
  }

  const storagePath = buildProblemReportStoragePath(
    input.reportId,
    input.file.name
  );

  const { error: uploadError } = await supabase.storage
    .from(PROBLEM_REPORT_FILES_BUCKET)
    .upload(storagePath, input.file, {
      contentType: input.file.type || undefined,
      upsert: false,
    });

  if (uploadError) {
    return { ok: false as const, message: uploadError.message };
  }

  const { data, error: insertError } = await supabase
    .from("problem_report_attachments")
    .insert({
      report_id: input.reportId,
      storage_path: storagePath,
      file_name: input.file.name,
      file_type: input.file.type || "application/octet-stream",
      file_size: input.file.size,
      uploaded_by: input.uploadedBy,
    })
    .select("*")
    .single();

  if (insertError) {
    await supabase.storage.from(PROBLEM_REPORT_FILES_BUCKET).remove([storagePath]);
    return { ok: false as const, message: insertError.message };
  }

  return { ok: true as const, attachment: data };
}

export async function fetchProblemReportAttachment(
  supabase: SupabaseClient,
  reportId: string
) {
  const { data, error } = await supabase
    .from("problem_report_attachments")
    .select("*")
    .eq("report_id", reportId)
    .maybeSingle();

  if (error) {
    return { attachment: null, error: error.message };
  }

  return { attachment: data, error: null };
}
