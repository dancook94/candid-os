export type ExceptionQueueTab =
  | "needs_attention"
  | "matched"
  | "ignored"
  | "all_imported";

/** @deprecated Use `matched` — kept for URL backwards compatibility during transition. */
export type LegacyExceptionQueueTab =
  | ExceptionQueueTab
  | "suggested_matches"
  | "confirmed";

export type PrintfactoryQueueRecord = {
  id: string;
  job_match_status: string;
  candid_job_id: string | null;
  suggested_candid_job_id?: string | null;
  match_suggestion_reason?: string | null;
  is_multi_job_sheet?: boolean | null;
  printfactory_job_candid_jobs?: Array<{
    candid_job_id: string;
  }>;
  printfactory_job_manifest_items?: Array<{
    link_status: string;
    match_confidence: number | null;
    suggestion_reason?: string | null;
    is_possible_reprint?: boolean;
  }>;
};

export function assignPrintfactoryRecordTab(
  record: PrintfactoryQueueRecord
): ExceptionQueueTab {
  if (record.job_match_status === "ignored") {
    return "ignored";
  }

  const links = record.printfactory_job_manifest_items ?? [];
  const hasConfirmedLink = links.some((link) => link.link_status === "confirmed");
  const hasSuggestedLink = links.some((link) => link.link_status === "suggested");
  const highConfidenceSuggestions = links.filter(
    (link) =>
      link.link_status === "suggested" &&
      (link.match_confidence ?? 0) >= 0.85
  );

  const isParentMatched =
    record.job_match_status === "matched_automatically" ||
    record.job_match_status === "matched_manually";

  const linkedJobCount = Math.max(
    record.printfactory_job_candid_jobs?.length ?? 0,
    record.candid_job_id ? 1 : 0
  );

  const hasPossibleReprint = links.some((link) => link.is_possible_reprint);

  if (
    record.job_match_status === "unmatched" ||
    record.job_match_status === "conflict" ||
    record.job_match_status === "suggested" ||
    record.suggested_candid_job_id ||
    hasPossibleReprint
  ) {
    return "needs_attention";
  }

  if (isParentMatched && hasConfirmedLink) {
    return "matched";
  }

  if (isParentMatched && hasSuggestedLink) {
    return "needs_attention";
  }

  if (isParentMatched && highConfidenceSuggestions.length > 1) {
    return "needs_attention";
  }

  if (isParentMatched && !hasConfirmedLink && !hasSuggestedLink && links.length > 0) {
    return "needs_attention";
  }

  if (isParentMatched && linkedJobCount > 0) {
    return "matched";
  }

  if (isParentMatched) {
    return "matched";
  }

  return "needs_attention";
}

export function countPrintfactoryRecordsByTab(
  records: PrintfactoryQueueRecord[]
): Record<ExceptionQueueTab, number> {
  const counts: Record<ExceptionQueueTab, number> = {
    needs_attention: 0,
    matched: 0,
    ignored: 0,
    all_imported: records.length,
  };

  for (const record of records) {
    const tab = assignPrintfactoryRecordTab(record);
    counts[tab] += 1;
  }

  return counts;
}

export function filterPrintfactoryRecordsByTab(
  records: PrintfactoryQueueRecord[],
  tab: ExceptionQueueTab
) {
  if (tab === "all_imported") {
    return records;
  }

  return records.filter((record) => assignPrintfactoryRecordTab(record) === tab);
}

export function normalizeExceptionQueueTab(value: string | undefined): ExceptionQueueTab {
  if (value === "matched" || value === "confirmed") {
    return "matched";
  }

  if (value === "ignored") {
    return "ignored";
  }

  if (value === "all_imported" || value === "all") {
    return "all_imported";
  }

  return "needs_attention";
}

export const EXCEPTION_QUEUE_TAB_LABELS: Record<ExceptionQueueTab, string> = {
  needs_attention: "Needs attention",
  matched: "Matched",
  ignored: "Ignored",
  all_imported: "All",
};
