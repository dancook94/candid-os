export type ExceptionQueueTab =
  | "needs_attention"
  | "suggested_matches"
  | "confirmed"
  | "ignored"
  | "all_imported";

export type PrintfactoryQueueRecord = {
  id: string;
  job_match_status: string;
  candid_job_id: string | null;
  suggested_candid_job_id?: string | null;
  match_suggestion_reason?: string | null;
  printfactory_job_manifest_items?: Array<{
    link_status: string;
    match_confidence: number | null;
    suggestion_reason?: string | null;
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

  if (
    record.job_match_status === "unmatched" ||
    record.job_match_status === "conflict"
  ) {
    return "needs_attention";
  }

  if (record.job_match_status === "suggested" || record.suggested_candid_job_id) {
    return "suggested_matches";
  }

  if (isParentMatched && hasConfirmedLink) {
    return "confirmed";
  }

  if (isParentMatched && hasSuggestedLink) {
    return "suggested_matches";
  }

  if (isParentMatched && highConfidenceSuggestions.length > 1) {
    return "needs_attention";
  }

  if (isParentMatched && !hasConfirmedLink && !hasSuggestedLink) {
    return "needs_attention";
  }

  if (isParentMatched) {
    return "confirmed";
  }

  return "needs_attention";
}

export function countPrintfactoryRecordsByTab(
  records: PrintfactoryQueueRecord[]
): Record<ExceptionQueueTab, number> {
  const counts: Record<ExceptionQueueTab, number> = {
    needs_attention: 0,
    suggested_matches: 0,
    confirmed: 0,
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

export const EXCEPTION_QUEUE_TAB_LABELS: Record<ExceptionQueueTab, string> = {
  needs_attention: "Needs attention",
  suggested_matches: "Suggested matches",
  confirmed: "Confirmed",
  ignored: "Ignored",
  all_imported: "All imported",
};
