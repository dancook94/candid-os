import type { SyncStageName } from "@/lib/printfactory/sync-timing";

export type SyncSummaryInput = {
  recordsReceived: number;
  imported: number;
  refreshed: number;
  parentJobsAutoMatched: number;
  parentJobSuggestions: number;
  needsAttention: number;
  pagesFetched: number;
  hasMore: boolean;
  windowCapped: boolean;
  partial: boolean;
  failingStage: SyncStageName | null;
  dateTimeFrom: string | null;
  dateTimeTo: string | null;
};

export function buildSyncSummaryMessage(input: SyncSummaryInput): string {
  if (input.recordsReceived === 0) {
    return "Live sync: no PrintFactory jobs returned in the sync window.";
  }

  const lines = [
    input.partial && input.failingStage
      ? `Live sync complete (partial — ${input.failingStage.replace(/_/g, " ")} failed after commit).`
      : "Live sync complete:",
    `- ${input.recordsReceived} record${input.recordsReceived === 1 ? "" : "s"} received`,
    `- ${input.imported} new job${input.imported === 1 ? "" : "s"} imported`,
    `- ${input.refreshed} existing job${input.refreshed === 1 ? "" : "s"} refreshed`,
    `- ${input.parentJobsAutoMatched} job${input.parentJobsAutoMatched === 1 ? "" : "s"} matched automatically`,
    `- ${input.needsAttention} need${input.needsAttention === 1 ? "s" : ""} attention`,
    `- ${input.pagesFetched} page${input.pagesFetched === 1 ? "" : "s"} fetched`,
  ];

  if (input.dateTimeFrom && input.dateTimeTo) {
    lines.push(`- Window: ${input.dateTimeFrom} → ${input.dateTimeTo}`);
  }

  lines.push(`- More records available: ${input.hasMore ? "Yes" : "No"}`);

  if (input.windowCapped) {
    lines.push(
      "- Live window capped: more jobs exist in the recent window than this run could process. Live watermark was not advanced."
    );
  }

  if (input.parentJobSuggestions > 0) {
    lines.splice(
      6,
      0,
      `- ${input.parentJobSuggestions} suggested match${input.parentJobSuggestions === 1 ? "" : "es"}`
    );
  }

  return lines.join("\n");
}
