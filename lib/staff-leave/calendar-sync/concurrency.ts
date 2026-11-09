import type { SupabaseClient } from "@supabase/supabase-js";

type CalendarOutboxSiblingRow = {
  leave_request_id: string | null;
  sickness_id: string | null;
};

export async function hasFreshCalendarOutboxSiblingProcessing(
  adminClient: SupabaseClient,
  row: CalendarOutboxSiblingRow,
  staleBeforeIso: string
) {
  const entityFilter =
    row.leave_request_id != null
      ? { column: "leave_request_id" as const, value: row.leave_request_id }
      : row.sickness_id != null
        ? { column: "sickness_id" as const, value: row.sickness_id }
        : null;

  if (!entityFilter) {
    return false;
  }

  const { count, error } = await adminClient
    .from("staff_leave_calendar_sync_outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .gte("locked_at", staleBeforeIso)
    .eq(entityFilter.column, entityFilter.value);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return false;
    }

    throw error;
  }

  return (count ?? 0) > 0;
}

export async function claimCalendarOutboxBatch(
  adminClient: SupabaseClient,
  input: { limit: number; staleBeforeIso: string }
): Promise<string[] | null> {
  const { data, error } = await adminClient.rpc("staff_leave_calendar_claim_outbox_batch", {
    p_limit: input.limit,
    p_stale_before: input.staleBeforeIso,
  });

  if (error) {
    if (
      error.code === "PGRST202" ||
      error.code === "42883" ||
      /staff_leave_calendar_claim_outbox_batch/i.test(error.message ?? "")
    ) {
      return null;
    }

    throw error;
  }

  return (data as string[] | null) ?? [];
}
