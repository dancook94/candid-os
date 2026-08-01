import type { SupabaseClient } from "@supabase/supabase-js";

import {
  applyQuoteStatusResponse,
  isQuoteAwaitingDecision,
  quoteResponseConflictMessage,
  type QuoteResponseAction,
  type QuoteStatusResponseResult,
} from "@/lib/quote-status-response";
import {
  deleteQuoteItemImageObject,
  formatSupabaseStorageError,
  QUOTE_ITEM_IMAGES_BUCKET,
} from "@/lib/quote-item-images";

type LoadedAdminQuoteContext = {
  quote: {
    id: string;
    quote_number: number;
    status: string;
    current_version: number;
  };
  version: {
    id: string;
    version_number: number;
    version_status: string;
  };
};

export type AdminQuoteActionResult = QuoteStatusResponseResult;

function responseError(status: number, message: string): AdminQuoteActionResult {
  return { ok: false, status, message };
}

async function loadAdminQuoteContext(
  supabase: SupabaseClient,
  quoteId: string
): Promise<AdminQuoteActionResult | LoadedAdminQuoteContext> {
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, quote_number, status, current_version")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    return responseError(500, quoteError.message);
  }

  if (!quote) {
    return responseError(404, "Quote not found.");
  }

  const { data: version, error: versionError } = await supabase
    .from("quote_versions")
    .select("id, version_number, version_status")
    .eq("quote_id", quote.id)
    .eq("version_number", quote.current_version)
    .maybeSingle();

  if (versionError) {
    return responseError(500, versionError.message);
  }

  if (!version) {
    return responseError(409, "This quote version is no longer available.");
  }

  if (
    !isQuoteAwaitingDecision({
      quoteStatus: quote.status,
      versionStatus: version.version_status,
      versionNumber: version.version_number,
      currentVersion: quote.current_version,
    })
  ) {
    return responseError(
      409,
      quoteResponseConflictMessage(quote.status, version.version_status)
    );
  }

  return { quote, version };
}

export async function respondToQuoteAsAdmin(
  supabase: SupabaseClient,
  {
    quoteId,
    action,
  }: {
    quoteId: string;
    action: QuoteResponseAction;
  }
): Promise<AdminQuoteActionResult> {
  const loaded = await loadAdminQuoteContext(supabase, quoteId);

  if ("ok" in loaded) {
    return loaded;
  }

  return applyQuoteStatusResponse(supabase, loaded, action);
}

export type PermanentDeleteQuoteResult =
  | { ok: true; storageWarnings: string[] }
  | { ok: false; status: number; message: string; storageWarnings?: string[] };

export async function permanentlyDeleteQuoteAsAdmin(
  supabase: SupabaseClient,
  {
    quoteId,
    confirmation,
  }: {
    quoteId: string;
    confirmation: string;
  }
): Promise<PermanentDeleteQuoteResult> {
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, quote_number, status")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    return { ok: false, status: 500, message: quoteError.message };
  }

  if (!quote) {
    return { ok: false, status: 404, message: "Quote not found." };
  }

  const standardConfirmation = `Q-${quote.quote_number}`;
  const acceptedConfirmation = `DELETE Q-${quote.quote_number}`;

  if (quote.status === "accepted") {
    if (confirmation !== acceptedConfirmation) {
      return {
        ok: false,
        status: 400,
        message: `Type ${acceptedConfirmation} to permanently delete this accepted quote.`,
      };
    }
  } else if (confirmation !== standardConfirmation) {
    return {
      ok: false,
      status: 400,
      message: `Type ${standardConfirmation} to confirm permanent deletion.`,
    };
  }

  const { data: versions, error: versionsError } = await supabase
    .from("quote_versions")
    .select("id")
    .eq("quote_id", quote.id);

  if (versionsError) {
    return { ok: false, status: 500, message: versionsError.message };
  }

  const versionIds = (versions ?? []).map((version) => version.id);
  const storageWarnings: string[] = [];

  if (versionIds.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from("quote_items")
      .select("id, image_storage_path")
      .in("quote_version_id", versionIds);

    if (itemsError) {
      return { ok: false, status: 500, message: itemsError.message };
    }

    const imagePaths = [
      ...new Set(
        (items ?? [])
          .map((item) => item.image_storage_path)
          .filter((path): path is string => Boolean(path))
      ),
    ];

    for (const storagePath of imagePaths) {
      try {
        await deleteQuoteItemImageObject(supabase, storagePath);
      } catch (error) {
        storageWarnings.push(
          `${storagePath}: ${formatSupabaseStorageError(error)}`
        );
      }
    }

    if (storageWarnings.length > 0) {
      return {
        ok: false,
        status: 500,
        message:
          "Unable to delete all quote item images. The quote was not removed.",
        storageWarnings,
      };
    }

    const { error: deleteItemsError } = await supabase
      .from("quote_items")
      .delete()
      .in("quote_version_id", versionIds);

    if (deleteItemsError) {
      return { ok: false, status: 500, message: deleteItemsError.message };
    }

    const { error: deleteVersionsError } = await supabase
      .from("quote_versions")
      .delete()
      .eq("quote_id", quote.id);

    if (deleteVersionsError) {
      return { ok: false, status: 500, message: deleteVersionsError.message };
    }
  }

  const { data: deletedQuote, error: deleteQuoteError } = await supabase
    .from("quotes")
    .delete()
    .eq("id", quote.id)
    .select("id")
    .maybeSingle();

  if (deleteQuoteError) {
    return { ok: false, status: 500, message: deleteQuoteError.message };
  }

  if (!deletedQuote) {
    return {
      ok: false,
      status: 500,
      message: "Unable to delete the quote record.",
    };
  }

  return { ok: true, storageWarnings };
}

export function buildPermanentDeleteConfirmationHint(quoteNumber: number, quoteStatus: string) {
  if (quoteStatus === "accepted") {
    return `DELETE Q-${quoteNumber}`;
  }

  return `Q-${quoteNumber}`;
}

export { QUOTE_ITEM_IMAGES_BUCKET };
