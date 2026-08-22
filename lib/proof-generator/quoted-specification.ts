import type { SupabaseClient } from "@supabase/supabase-js";

import { MANIFEST_ITEM_SELECT } from "@/lib/manifest/constants";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import type { QuotedSpecificationItem } from "@/lib/proof-generator/types";
import { ProofError } from "@/lib/proofs/errors";

type QuoteItemRow = {
  id: string;
  title: string;
  description: string | null;
};

function parseNumeric(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDimensionsFromText(
  text: string | null | undefined
): { widthMm: number; heightMm: number } | null {
  if (!text?.trim()) {
    return null;
  }

  const normalized = text.replace(/,/g, ".").replace(/\s+/g, " ").trim();

  const labelledMatch = normalized.match(
    /(?:finished\s*size|size|dimensions?)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:mm\s*)?[x×X]\s*(\d+(?:\.\d+)?)\s*mm?/i
  );
  if (labelledMatch) {
    return {
      widthMm: Number(labelledMatch[1]),
      heightMm: Number(labelledMatch[2]),
    };
  }

  const plainMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:mm\s*)?[x×X]\s*(\d+(?:\.\d+)?)\s*mm/i
  );
  if (plainMatch) {
    return {
      widthMm: Number(plainMatch[1]),
      heightMm: Number(plainMatch[2]),
    };
  }

  return null;
}

export function parseLabelledFieldFromText(
  text: string | null | undefined,
  labels: string[]
): string | null {
  if (!text?.trim()) {
    return null;
  }

  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(?:^|[\\n\\r]|\\|)\\s*${escaped}\\s*[:\\-]\\s*([^\\n\\r|]+)`,
      "i"
    );
    const match = text.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  return null;
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (value?.trim()) {
      return value.trim();
    }
  }

  return null;
}

function collectDescriptionSources(
  item: ManifestItemRecord,
  quoteItem: QuoteItemRow | null
) {
  return [item.description, quoteItem?.description].filter(Boolean).join("\n");
}

function resolveMaterial(
  item: ManifestItemRecord,
  quoteItem: QuoteItemRow | null
) {
  const descriptionText = collectDescriptionSources(item, quoteItem);

  return firstNonEmpty(
    item.material,
    parseLabelledFieldFromText(descriptionText, ["Material", "Substrate", "Media"]),
    item.media_profile
  );
}

function buildPrintSpecification(
  item: ManifestItemRecord,
  quoteItem: QuoteItemRow | null
) {
  const structured = [item.material, item.media_profile, item.machine]
    .filter(Boolean)
    .join(" | ");

  if (structured) {
    return structured;
  }

  const descriptionText = collectDescriptionSources(item, quoteItem);

  return firstNonEmpty(
    parseLabelledFieldFromText(descriptionText, [
      "Print specification",
      "Print spec",
      "Print",
      "Process",
      "Media profile",
      "Machine",
    ]),
    item.media_profile,
    item.machine
  );
}

function formatSidesValue(value: string | null) {
  if (!value?.trim()) {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case "single":
      return "Single sided";
    case "double":
      return "Double sided";
    default:
      return value.trim();
  }
}

function resolveSides(
  item: ManifestItemRecord,
  quoteItem: QuoteItemRow | null
) {
  const descriptionText = collectDescriptionSources(item, quoteItem);

  return firstNonEmpty(
    item.sides ? formatSidesValue(item.sides) : null,
    parseLabelledFieldFromText(descriptionText, ["Sides", "Side"])
  );
}

function resolveFinishing(
  item: ManifestItemRecord,
  quoteItem: QuoteItemRow | null
) {
  const descriptionText = collectDescriptionSources(item, quoteItem);

  return firstNonEmpty(
    item.finishing_notes,
    parseLabelledFieldFromText(descriptionText, [
      "Finishing",
      "Finish",
      "Finishing notes",
      "Lamination",
    ])
  );
}

function resolveQuotedDimensions(
  item: ManifestItemRecord,
  quoteItem: QuoteItemRow | null
) {
  const widthMm = parseNumeric(item.width_mm);
  const heightMm = parseNumeric(item.height_mm);

  if (widthMm != null && heightMm != null) {
    return { widthMm, heightMm };
  }

  const fromManifestDescription = parseDimensionsFromText(item.description);
  if (fromManifestDescription) {
    return fromManifestDescription;
  }

  const fromQuoteDescription = parseDimensionsFromText(quoteItem?.description ?? null);
  if (fromQuoteDescription) {
    return fromQuoteDescription;
  }

  return {
    widthMm,
    heightMm,
  };
}

function mapManifestItemToQuotedSpecification(
  item: ManifestItemRecord,
  quoteItem: QuoteItemRow | null
): QuotedSpecificationItem {
  const { widthMm, heightMm } = resolveQuotedDimensions(item, quoteItem);

  return {
    id: item.id,
    itemReference: item.item_reference,
    itemName: item.item_name,
    description: item.description?.trim() || quoteItem?.description?.trim() || null,
    quantity: parseNumeric(item.quantity) ?? parseNumeric(item.quoted_quantity),
    quotedWidthMm: widthMm,
    quotedHeightMm: heightMm,
    material: resolveMaterial(item, quoteItem),
    printSpecification: buildPrintSpecification(item, quoteItem),
    sides: resolveSides(item, quoteItem),
    finishing: resolveFinishing(item, quoteItem),
    notes: item.internal_note?.trim() || null,
  };
}

export async function loadQuotedSpecificationItems(
  adminClient: SupabaseClient,
  jobId: string,
  productionItemIds: string[]
): Promise<QuotedSpecificationItem[]> {
  const { data, error } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("job_id", jobId)
    .in("id", productionItemIds)
    .is("deleted_at", null);

  if (error) {
    throw new ProofError(error.message, 500);
  }

  if ((data ?? []).length !== productionItemIds.length) {
    throw new ProofError("One or more manifest items were not found on this job.", 404);
  }

  const manifestItems = (data ?? []) as ManifestItemRecord[];
  const quoteItemIds = manifestItems
    .map((item) => item.quote_item_id)
    .filter((id): id is string => Boolean(id));

  let quoteItemsById = new Map<string, QuoteItemRow>();

  if (quoteItemIds.length) {
    const { data: quoteItems, error: quoteError } = await adminClient
      .from("quote_items")
      .select("id, title, description")
      .in("id", quoteItemIds);

    if (quoteError) {
      throw new ProofError(quoteError.message, 500);
    }

    quoteItemsById = new Map(
      (quoteItems ?? []).map((item) => [
        item.id as string,
        {
          id: item.id as string,
          title: item.title as string,
          description: (item.description as string | null) ?? null,
        },
      ])
    );
  }

  const byId = new Map(
    manifestItems.map((item) => [
      item.id,
      mapManifestItemToQuotedSpecification(
        item,
        item.quote_item_id ? quoteItemsById.get(item.quote_item_id) ?? null : null
      ),
    ])
  );

  return productionItemIds
    .map((id) => byId.get(id))
    .filter((item): item is QuotedSpecificationItem => Boolean(item));
}
