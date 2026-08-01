import type { SupabaseClient } from "@supabase/supabase-js";

export const QUOTE_REQUEST_FILES_BUCKET = "quote-request-files";

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "xlsx",
  "xls",
  "csv",
  "doc",
  "docx",
  "zip",
  "jpg",
  "jpeg",
  "png",
  "ai",
  "eps",
  "svg",
]);

export const QUOTE_REQUEST_FILE_ACCEPT =
  ".pdf,.xlsx,.xls,.csv,.doc,.docx,.zip,.jpg,.jpeg,.png,.ai,.eps,.svg";

export type QuoteRequestAttachmentRecord = {
  id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  storage_path: string;
  created_at: string;
};

export type QuoteRequestAttachmentInsert = {
  quote_request_id: string;
  company_id: string;
  uploaded_by: string;
  file_name: string;
  storage_path: string;
  file_type: string;
  file_size: number;
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

  return cleaned || "file";
}

export function validateQuoteRequestFile(file: File) {
  const extension = getFileExtension(file.name);

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return "File type not allowed. Upload PDF, Excel, Word, ZIP, JPG, PNG, AI, EPS, or SVG files.";
  }

  return null;
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildStoragePath(
  companyId: string,
  quoteRequestId: string,
  fileName: string,
  timestamp: number = Date.now()
) {
  const sanitizedFileName = sanitizeFileName(fileName);
  return `${companyId}/${quoteRequestId}/${timestamp}-${sanitizedFileName}`;
}

export function buildUniqueStoragePath(
  companyId: string,
  quoteRequestId: string,
  fileName: string,
  usedPaths: Set<string>
) {
  let timestamp = Date.now();
  let candidate = buildStoragePath(
    companyId,
    quoteRequestId,
    fileName,
    timestamp
  );

  while (usedPaths.has(candidate)) {
    timestamp += 1;
    candidate = buildStoragePath(
      companyId,
      quoteRequestId,
      fileName,
      timestamp
    );
  }

  usedPaths.add(candidate);
  return candidate;
}

export async function uploadQuoteRequestAttachment(
  supabase: SupabaseClient,
  {
    file,
    companyId,
    quoteRequestId,
    uploadedBy,
    storagePath,
  }: {
    file: File;
    companyId: string;
    quoteRequestId: string;
    uploadedBy: string;
    storagePath: string;
  }
) {
  if (process.env.NODE_ENV === "development") {
    console.log("[quote-request upload] bucket:", QUOTE_REQUEST_FILES_BUCKET);
    console.log("[quote-request upload] company_id:", companyId);
    console.log("[quote-request upload] quote_request_id:", quoteRequestId);
    console.log("[quote-request upload] storage path:", storagePath);
  }

  const { error: uploadError } = await supabase.storage
    .from(QUOTE_REQUEST_FILES_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const insertPayload: QuoteRequestAttachmentInsert = {
    quote_request_id: quoteRequestId,
    company_id: companyId,
    uploaded_by: uploadedBy,
    file_name: file.name,
    storage_path: storagePath,
    file_type: file.type || "application/octet-stream",
    file_size: file.size,
  };

  const { error: insertError } = await supabase
    .from("quote_request_attachments")
    .insert(insertPayload);

  if (insertError) {
    throw new Error(insertError.message);
  }
}

export async function uploadQuoteRequestAttachments(
  supabase: SupabaseClient,
  {
    files,
    companyId,
    quoteRequestId,
    uploadedBy,
  }: {
    files: File[];
    companyId: string;
    quoteRequestId: string;
    uploadedBy: string;
  }
) {
  if (!companyId) {
    throw new Error("company_id is required before uploading files.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("company_id, account_status")
    .eq("id", uploadedBy)
    .single();

  if (profileError || !profile) {
    throw new Error(profileError?.message ?? "Unable to verify profile.");
  }

  if (profile.account_status !== "approved") {
    throw new Error("Your account must be approved before uploading files.");
  }

  if (!profile.company_id) {
    throw new Error("Your profile must be linked to a company before uploading files.");
  }

  if (profile.company_id !== companyId) {
    throw new Error("Upload company_id does not match your profile company.");
  }

  const usedPaths = new Set<string>();

  for (const file of files) {
    const validationError = validateQuoteRequestFile(file);

    if (validationError) {
      throw new Error(validationError);
    }

    const storagePath = buildUniqueStoragePath(
      companyId,
      quoteRequestId,
      file.name,
      usedPaths
    );

    await uploadQuoteRequestAttachment(supabase, {
      file,
      companyId,
      quoteRequestId,
      uploadedBy,
      storagePath,
    });
  }
}
