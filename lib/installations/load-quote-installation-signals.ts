import type { SupabaseClient } from "@supabase/supabase-js";

import {
  detectInstallationSignals,
  type QuoteItemForInstallationDetection,
} from "@/lib/installations/detection";

/**
 * Production cost components hang off quote_item_costs, not quote_items directly.
 * quote_item_cost_components.quote_item_cost_id → quote_item_costs.id → quote_item_costs.quote_item_id
 */
export async function loadQuoteVersionInstallationSignals(
  adminClient: SupabaseClient,
  quoteVersionId: string
) {
  const { data: quoteItems, error: itemsError } = await adminClient
    .from("quote_items")
    .select("id, title, is_optional, is_selected")
    .eq("quote_version_id", quoteVersionId);

  if (itemsError) {
    throw new Error(itemsError.message);
  }

  const items = (quoteItems ?? []) as QuoteItemForInstallationDetection[];
  const itemIds = items.map((row) => row.id);

  const componentRows: Array<{
    quote_item_id: string;
    component_type: string;
  }> = [];

  if (itemIds.length > 0) {
    const { data: costs, error: costsError } = await adminClient
      .from("quote_item_costs")
      .select("id, quote_item_id")
      .in("quote_item_id", itemIds);

    if (costsError) {
      throw new Error(costsError.message);
    }

    const costIds = (costs ?? []).map((row) => String(row.id));
    const itemIdByCostId = new Map(
      (costs ?? []).map((row) => [String(row.id), String(row.quote_item_id)])
    );

    if (costIds.length > 0) {
      const { data: components, error: componentsError } = await adminClient
        .from("quote_item_cost_components")
        .select("quote_item_cost_id, component_type")
        .in("quote_item_cost_id", costIds);

      if (componentsError) {
        throw new Error(componentsError.message);
      }

      for (const component of components ?? []) {
        const quoteItemId = itemIdByCostId.get(String(component.quote_item_cost_id));
        if (!quoteItemId) {
          continue;
        }

        componentRows.push({
          quote_item_id: quoteItemId,
          component_type: String(component.component_type),
        });
      }
    }
  }

  return detectInstallationSignals(items, componentRows);
}
