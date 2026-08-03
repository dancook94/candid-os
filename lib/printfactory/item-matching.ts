import type { MatchConfidenceLevel } from "@/lib/printfactory/constants";
import {
  extractItemReferenceFromText,
  extractFilenameFromPath,
} from "@/lib/printfactory/job-reference-parser";

export type ManifestItemMatchCandidate = {
  id: string;
  item_reference: string | null;
  item_name: string;
  description: string | null;
  width_mm: number | null;
  height_mm: number | null;
  material: string | null;
  production_requirement_status: string;
  deleted_at: string | null;
  combined_into_item_id: string | null;
};

export type ItemMatchSuggestion = {
  productionItemId: string;
  itemReference: string | null;
  itemName: string;
  confidence: number;
  confidenceLevel: MatchConfidenceLevel;
  matchMethod: string;
};

export type PrintfactoryItemMatchInput = {
  source_file_path: string | null;
  source_file_name: string | null;
  job_name: string | null;
  media_type: string | null;
};

function normalizeFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeFilename(left).split(/\s+/).filter(Boolean));
  const rightTokens = new Set(
    normalizeFilename(right).split(/\s+/).filter(Boolean)
  );

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function confidenceLevel(score: number): MatchConfidenceLevel {
  if (score >= 0.85) {
    return "high";
  }

  if (score >= 0.6) {
    return "medium";
  }

  return "low";
}

function isActiveManifestItem(item: ManifestItemMatchCandidate) {
  if (item.deleted_at || item.combined_into_item_id) {
    return false;
  }

  return !["cancelled", "combined", "not_required"].includes(
    item.production_requirement_status
  );
}

export function suggestManifestItemMatches(
  printfactoryInput: PrintfactoryItemMatchInput,
  manifestItems: ManifestItemMatchCandidate[],
  priorConfirmedPatterns: { filenamePattern: string; productionItemId: string }[] = []
): ItemMatchSuggestion[] {
  const activeItems = manifestItems.filter(isActiveManifestItem);

  if (activeItems.length === 0) {
    return [];
  }

  const searchTexts = [
    printfactoryInput.source_file_path,
    printfactoryInput.source_file_name,
    printfactoryInput.job_name,
    extractFilenameFromPath(printfactoryInput.source_file_path ?? ""),
  ].filter(Boolean) as string[];

  const filename =
    printfactoryInput.source_file_name ??
    extractFilenameFromPath(printfactoryInput.source_file_path ?? "") ??
    "";

  const suggestions: ItemMatchSuggestion[] = [];

  for (const item of activeItems) {
    let score = 0;
    let matchMethod = "filename_similarity";

    for (const text of searchTexts) {
      const extractedRef = extractItemReferenceFromText(text);

      if (extractedRef && item.item_reference) {
        if (extractedRef.toUpperCase() === item.item_reference.toUpperCase()) {
          score = Math.max(score, 1);
          matchMethod = "exact_item_reference";
          break;
        }
      }
    }

    if (score < 1 && filename) {
      const titleScore = tokenSimilarity(filename, item.item_name);
      const descriptionScore = item.description
        ? tokenSimilarity(filename, item.description)
        : 0;
      const filenameScore = Math.max(titleScore, descriptionScore);

      if (filenameScore > 0) {
        score = Math.max(score, filenameScore * 0.75);
        matchMethod = "filename_similarity";
      }
    }

    if (
      score < 0.85 &&
      printfactoryInput.media_type &&
      item.material &&
      normalizeFilename(printfactoryInput.media_type).includes(
        normalizeFilename(item.material)
      )
    ) {
      score = Math.max(score, 0.65);
      matchMethod = "material_match";
    }

    for (const pattern of priorConfirmedPatterns) {
      if (
        pattern.productionItemId === item.id &&
        filename &&
        normalizeFilename(filename).includes(normalizeFilename(pattern.filenamePattern))
      ) {
        score = Math.max(score, 0.9);
        matchMethod = "prior_confirmed_mapping";
      }
    }

    if (score >= 0.4) {
      suggestions.push({
        productionItemId: item.id,
        itemReference: item.item_reference,
        itemName: item.item_name,
        confidence: Number(score.toFixed(2)),
        confidenceLevel: confidenceLevel(score),
        matchMethod,
      });
    }
  }

  return suggestions.sort((left, right) => right.confidence - left.confidence);
}
