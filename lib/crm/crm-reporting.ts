import type { SupabaseClient } from "@supabase/supabase-js";

import { OPEN_TASK_STATUSES } from "@/lib/crm/task-config";

export type CrmSummaryMetrics = {
  activePipelineValue: number;
  quoteSentValue: number;
  wonValue: number;
  lostValue: number;
  needsFollowUpCount: number;
  overdueTasksCount: number;
};

function parseNumeric(value: number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchCrmSummaryMetrics(
  supabase: SupabaseClient
): Promise<CrmSummaryMetrics> {
  const now = new Date().toISOString();

  const terminalFilter = '("won","lost")';

  const [
    { data: activeOpportunities },
    { data: quoteSentOpportunities },
    { data: wonOpportunities },
    { data: lostOpportunities },
    { count: needsFollowUpCount },
    { count: overdueTasksCount },
  ] = await Promise.all([
    supabase
      .from("opportunities")
      .select("estimated_value")
      .not("stage", "in", terminalFilter),
    supabase
      .from("opportunities")
      .select("estimated_value")
      .eq("stage", "quote_sent"),
    supabase.from("opportunities").select("estimated_value").eq("stage", "won"),
    supabase.from("opportunities").select("estimated_value").eq("stage", "lost"),
    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .lt("next_follow_up_at", now)
      .not("stage", "in", terminalFilter),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .in("status", OPEN_TASK_STATUSES)
      .lt("due_at", now),
  ]);

  const sumEstimated = (rows: { estimated_value: number | string | null }[] | null) =>
    (rows ?? []).reduce((total, row) => total + parseNumeric(row.estimated_value), 0);

  return {
    activePipelineValue: sumEstimated(activeOpportunities),
    quoteSentValue: sumEstimated(quoteSentOpportunities),
    wonValue: sumEstimated(wonOpportunities),
    lostValue: sumEstimated(lostOpportunities),
    needsFollowUpCount: needsFollowUpCount ?? 0,
    overdueTasksCount: overdueTasksCount ?? 0,
  };
}
