import type { SupabaseClient } from "@supabase/supabase-js";

export const QUOTE_ITEM_IMAGES_BUCKET = "quote-item-images";

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const QUOTE_ITEM_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

export type QuoteItemImageMetadata = {
  image_storage_path: string | null;
  image_file_name: string | null;
  image_file_type: string | null;
  image_file_size: number | null;
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

  return cleaned || "image";
}

export function validateQuoteItemImageFile(file: File) {
  const extension = getFileExtension(file.name);

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return "Image must be JPG, JPEG, PNG, or WEBP.";
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "Image must be 10 MB or smaller.";
  }

  return null;
}

export function buildQuoteItemImageStoragePath(
  quoteId: string,
  quoteVersionId: string,
  quoteItemId: string,
  fileName: string,
  timestamp: number = Date.now()
) {
  const sanitizedFileName = sanitizeFileName(fileName);
  return `${quoteId}/${quoteVersionId}/${quoteItemId}/${timestamp}-${sanitizedFileName}`;
}

export function formatSupabaseStorageError(error: unknown) {
  if (!error || typeof error !== "object") {
    return "Unable to process quote item image.";
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

  return "Unable to process quote item image.";
}

export async function createQuoteItemImageSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresInSeconds = 3600
) {
  const { data, error } = await supabase.storage
    .from(QUOTE_ITEM_IMAGES_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

export async function uploadQuoteItemImage(
  supabase: SupabaseClient,
  {
    file,
    quoteId,
    quoteVersionId,
    quoteItemId,
  }: {
    file: File;
    quoteId: string;
    quoteVersionId: string;
    quoteItemId: string;
  }
) {
  const validationError = validateQuoteItemImageFile(file);

  if (validationError) {
    throw new Error(validationError);
  }

  const storagePath = buildQuoteItemImageStoragePath(
    quoteId,
    quoteVersionId,
    quoteItemId,
    file.name
  );

  const { error: uploadError } = await supabase.storage
    .from(QUOTE_ITEM_IMAGES_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  return {
    image_storage_path: storagePath,
    image_file_name: file.name,
    image_file_type: file.type || "application/octet-stream",
    image_file_size: file.size,
  };
}

export async function isQuoteItemImagePathReferenced(
  supabase: SupabaseClient,
  storagePath: string,
  excludingQuoteItemId?: string
) {
  let query = supabase
    .from("quote_items")
    .select("id")
    .eq("image_storage_path", storagePath);

  if (excludingQuoteItemId) {
    query = query.neq("id", excludingQuoteItemId);
  }

  const { data, error } = await query.limit(1);

  if (error) {
    throw error;
  }

  return (data?.length ?? 0) > 0;
}

export async function deleteQuoteItemImageObjectIfUnreferenced(
  supabase: SupabaseClient,
  storagePath: string | null | undefined,
  excludingQuoteItemId?: string
) {
  if (!storagePath) {
    return;
  }

  const isReferenced = await isQuoteItemImagePathReferenced(
    supabase,
    storagePath,
    excludingQuoteItemId
  );

  if (isReferenced) {
    return;
  }

  await deleteQuoteItemImageObject(supabase, storagePath);
}

export async function updateQuoteItemImageMetadata(
  supabase: SupabaseClient,
  quoteItemId: string,
  metadata: QuoteItemImageMetadata
) {
  const { error } = await supabase
    .from("quote_items")
    .update(metadata)
    .eq("id", quoteItemId);

  if (error) {
    throw error;
  }
}

export type LineItemImageSyncInput = {
  quoteItemId: string;
  pendingFile: File | null;
  imageRemoved: boolean;
  preservedMetadata: QuoteItemImageMetadata | null;
  previousStoragePath: string | null;
};

export async function syncQuoteVersionItemImages(
  supabase: SupabaseClient,
  quoteId: string,
  quoteVersionId: string,
  items: LineItemImageSyncInput[]
) {
  const retainedPaths = new Set<string>();

  for (const item of items) {
    if (item.pendingFile) {
      const metadata = await uploadQuoteItemImage(supabase, {
        file: item.pendingFile,
        quoteId,
        quoteVersionId,
        quoteItemId: item.quoteItemId,
      });

      await updateQuoteItemImageMetadata(supabase, item.quoteItemId, metadata);

      if (metadata.image_storage_path) {
        retainedPaths.add(metadata.image_storage_path);
      }

      if (
        item.previousStoragePath &&
        item.previousStoragePath !== metadata.image_storage_path
      ) {
        await deleteQuoteItemImageObjectIfUnreferenced(
          supabase,
          item.previousStoragePath,
          item.quoteItemId
        );
      }

      continue;
    }

    if (item.imageRemoved) {
      await updateQuoteItemImageMetadata(supabase, item.quoteItemId, {
        image_storage_path: null,
        image_file_name: null,
        image_file_type: null,
        image_file_size: null,
      });

      if (item.previousStoragePath) {
        await deleteQuoteItemImageObjectIfUnreferenced(
          supabase,
          item.previousStoragePath,
          item.quoteItemId
        );
      }

      continue;
    }

    if (item.preservedMetadata?.image_storage_path) {
      retainedPaths.add(item.preservedMetadata.image_storage_path);
    }
  }

  return retainedPaths;
}

export async function deleteQuoteItemImageObject(
  supabase: SupabaseClient,
  storagePath: string | null | undefined
) {
  if (!storagePath) {
    return;
  }

  const { error } = await supabase.storage
    .from(QUOTE_ITEM_IMAGES_BUCKET)
    .remove([storagePath]);

  if (error) {
    throw error;
  }
}

export async function deleteOrphanedQuoteItemImages(
  supabase: SupabaseClient,
  previousPaths: string[],
  retainedPaths: Set<string>
) {
  for (const storagePath of previousPaths) {
    if (!retainedPaths.has(storagePath)) {
      await deleteQuoteItemImageObjectIfUnreferenced(supabase, storagePath);
    }
  }
}

export function toQuoteItemImageInsertFields(
  metadata: QuoteItemImageMetadata | null | undefined
): QuoteItemImageMetadata {
  if (!metadata?.image_storage_path) {
    return {
      image_storage_path: null,
      image_file_name: null,
      image_file_type: null,
      image_file_size: null,
    };
  }

  return {
    image_storage_path: metadata.image_storage_path,
    image_file_name: metadata.image_file_name,
    image_file_type: metadata.image_file_type,
    image_file_size: metadata.image_file_size,
  };
}
