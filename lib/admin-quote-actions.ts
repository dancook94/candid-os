import type { SupabaseClient } from "@supabase/supabase-js";

import {
  applyQuoteStatusResponse,
  isQuoteAwaitingDecision,
  quoteResponseConflictMessage,
  type QuoteResponseAction,
  type QuoteStatusResponseResult,
} from "@/lib/quote-status-response";
import { syncOpportunityFromQuoteEvent } from "@/lib/crm/opportunity-stage-sync";
import {
  deleteQuoteItemImageObject,
  formatSupabaseStorageError,
  QUOTE_ITEM_IMAGES_BUCKET,
} from "@/lib/quote-item-images";
import {
  isPermanentDeleteConfirmationValid,
  permanentDeleteConfirmationErrorMessage,
} from "@/lib/permanent-delete-confirmation";

type LoadedAdminQuoteContext = {
  quote: {
    id: string;
    quote_number: number;
    status: string;
    current_version: number;
    opportunity_id: string | null;
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
    .select("id, quote_number, status, current_version, opportunity_id")
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
    changedBy,
  }: {
    quoteId: string;
    action: QuoteResponseAction;
    changedBy: string;
  }
): Promise<AdminQuoteActionResult> {
  const loaded = await loadAdminQuoteContext(supabase, quoteId);

  if ("ok" in loaded) {
    return loaded;
  }

  const result = await applyQuoteStatusResponse(supabase, loaded, action);

  if (!result.ok) {
    return result;
  }

  const syncEvent =
    action === "accept" ? "quote_accepted" : "quote_declined";

  await syncOpportunityFromQuoteEvent(supabase, {
    quoteId,
    event: syncEvent,
    changedBy,
  });

  return result;
}

export type PermanentDeleteQuoteResult =
  | { ok: true; storageWarnings: string[] }
  | { ok: false; status: number; message: string; storageWarnings?: string[] };

export type DeleteBrokenQuoteResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

async function collectQuoteItemImagePaths(
  supabase: SupabaseClient,
  quoteId: string
): Promise<
  | { ok: true; imagePaths: string[] }
  | { ok: false; status: number; message: string }
> {
  const { data: versions, error: versionsError } = await supabase
    .from("quote_versions")
    .select("id")
    .eq("quote_id", quoteId);

  if (versionsError) {
    return { ok: false, status: 500, message: versionsError.message };
  }

  const versionIds = (versions ?? []).map((version) => version.id);

  if (versionIds.length === 0) {
    return { ok: true, imagePaths: [] };
  }

  const { data: items, error: itemsError } = await supabase
    .from("quote_items")
    .select("image_storage_path")
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

  return { ok: true, imagePaths };
}

async function deleteQuoteItemImagesAfterCommit(
  supabase: SupabaseClient,
  imagePaths: string[]
) {
  const storageWarnings: string[] = [];

  for (const storagePath of imagePaths) {
    try {
      await deleteQuoteItemImageObject(supabase, storagePath);
    } catch (error) {
      storageWarnings.push(
        `${storagePath}: ${formatSupabaseStorageError(error)}`
      );
    }
  }

  return storageWarnings;
}

export async function permanentlyDeleteQuoteAsAdmin(
  supabase: SupabaseClient,
  {
    quoteId,
    confirmation,
    deletedBy,
  }: {
    quoteId: string;
    confirmation: string;
    deletedBy: string;
  }
): Promise<PermanentDeleteQuoteResult> {
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "id, quote_number, status, company_id, opportunity_id, contact_id, project_name"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    return { ok: false, status: 500, message: quoteError.message };
  }

  if (!quote) {
    return { ok: false, status: 404, message: "Quote not found." };
  }

  if (!isPermanentDeleteConfirmationValid(confirmation)) {
    return {
      ok: false,
      status: 400,
      message: permanentDeleteConfirmationErrorMessage(),
    };
  }

  const imagePathsResult = await collectQuoteItemImagePaths(supabase, quote.id);

  if (!imagePathsResult.ok) {
    return imagePathsResult;
  }

  const { error: deleteError } = await supabase.rpc("permanently_delete_quote", {
    p_quote_id: quote.id,
    p_deleted_by: deletedBy,
    p_description: `Quote Q-${quote.quote_number} permanently deleted.`,
    p_metadata: {
      quote_number: quote.quote_number,
      project_name: quote.project_name,
    },
  });

  if (deleteError) {
    return { ok: false, status: 500, message: deleteError.message };
  }

  const storageWarnings = await deleteQuoteItemImagesAfterCommit(
    supabase,
    imagePathsResult.imagePaths
  );

  return { ok: true, storageWarnings };
}

export async function deleteBrokenQuoteAsAdmin(
  supabase: SupabaseClient,
  {
    quoteId,
    confirmation,
  }: {
    quoteId: string;
    confirmation: string;
  }
): Promise<DeleteBrokenQuoteResult> {
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    return { ok: false, status: 500, message: quoteError.message };
  }

  if (!quote) {
    return { ok: false, status: 404, message: "Quote not found." };
  }

  if (!isPermanentDeleteConfirmationValid(confirmation)) {
    return {
      ok: false,
      status: 400,
      message: permanentDeleteConfirmationErrorMessage(),
    };
  }

  const { count, error: versionCountError } = await supabase
    .from("quote_versions")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quoteId);

  if (versionCountError) {
    return { ok: false, status: 500, message: versionCountError.message };
  }

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      status: 409,
      message: "Quote has versions. Use permanent delete instead.",
    };
  }

  const { error: deleteError } = await supabase.rpc("delete_broken_quote", {
    p_quote_id: quoteId,
  });

  if (deleteError) {
    return { ok: false, status: 500, message: deleteError.message };
  }

  return { ok: true };
}

export { QUOTE_ITEM_IMAGES_BUCKET };
