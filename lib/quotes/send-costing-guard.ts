import type { SupabaseClient } from "@supabase/supabase-js";

const SEND_BLOCKED_MESSAGE =
  "Complete internal costing on every included line before sending this quote.";

export function quoteSendBlockedByIncompleteCostingMessage(): string {
  return SEND_BLOCKED_MESSAGE;
}

/**
 * Server guard: any quote line with saved costing marked incomplete blocks send.
 * Draft save is unaffected.
 */
export async function quoteVersionHasIncompleteStoredCosting(
  client: SupabaseClient,
  versionId: string
): Promise<boolean> {
  const { data: items, error: itemsError } = await client
    .from("quote_items")
    .select("id")
    .eq("quote_version_id", versionId);

  if (itemsError || !items?.length) {
    return false;
  }

  const itemIds = items.map((item) => item.id);

  const { count, error: costError } = await client
    .from("quote_item_costs")
    .select("id", { count: "exact", head: true })
    .in("quote_item_id", itemIds)
    .eq("costing_status", "incomplete");

  if (costError) {
    return false;
  }

  return (count ?? 0) > 0;
}

export async function assertQuoteVersionCostingCompleteForSend(
  client: SupabaseClient,
  versionId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const incomplete = await quoteVersionHasIncompleteStoredCosting(client, versionId);

  if (incomplete) {
    return { ok: false, message: SEND_BLOCKED_MESSAGE };
  }

  return { ok: true };
}
