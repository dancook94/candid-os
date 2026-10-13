import type { SupabaseClient } from "@supabase/supabase-js";

import {
  costDraftFromSnapshot,
  type QuoteLineCostDraft,
} from "@/lib/quotes/costing";

export async function loadQuoteLineCosts(
  supabase: SupabaseClient,
  quoteItemIds: string[]
): Promise<Map<string, QuoteLineCostDraft>> {
  if (quoteItemIds.length === 0) {
    return new Map();
  }

  const { data: costs, error } = await supabase
    .from("quote_item_costs")
    .select(
      "id, quote_item_id, cost_kind, cost_basis, material_id, material_supplier_product_id, material_price_id, material_name, supplier_name, rate_per_sqm, finished_width_mm, finished_height_mm, quantity, manual_material_cost, default_finished_width_mm, default_finished_height_mm"
    )
    .in("quote_item_id", quoteItemIds);

  if (error || !costs) {
    return new Map();
  }

  const costIds = costs.map((cost) => String(cost.id));
  const componentsByCost = new Map<string, Array<Record<string, unknown>>>();
  const materialsByCost = new Map<string, Array<Record<string, unknown>>>();

  if (costIds.length > 0) {
    const [{ data: components, error: componentError }, { data: materials, error: materialError }] =
      await Promise.all([
        supabase
          .from("quote_item_cost_components")
          .select(
            "quote_item_cost_id, component_type, description, quantity, unit_cost, sort_order"
          )
          .in("quote_item_cost_id", costIds),
        supabase
          .from("quote_item_material_components")
          .select(
            "id, quote_item_cost_id, sort_order, source_kind, cost_basis, pricing_source, material_id, material_supplier_product_id, material_price_id, material_name, supplier_name, purchase_unit, snapshotted_rate, finished_width_mm, finished_height_mm, quantity, inherit_dimensions, inherit_quantity, manual_material_cost"
          )
          .in("quote_item_cost_id", costIds),
      ]);

    if (!componentError) {
      for (const component of components ?? []) {
        const costId = String(component.quote_item_cost_id);
        componentsByCost.set(costId, [...(componentsByCost.get(costId) ?? []), component]);
      }
    }

    if (!materialError) {
      for (const material of materials ?? []) {
        const costId = String(material.quote_item_cost_id);
        materialsByCost.set(costId, [...(materialsByCost.get(costId) ?? []), material]);
      }
    }
  }

  const drafts = new Map<string, QuoteLineCostDraft>();

  for (const cost of costs) {
    const costId = String(cost.id);
    const savedComponents = (componentsByCost.get(costId) ?? []).map((component) => ({
      component_type: String(component.component_type),
      description: (component.description as string | null) ?? null,
      quantity: component.quantity as number | string,
      unit_cost: component.unit_cost as number | string,
      sort_order: Number(component.sort_order),
    }));
    const savedMaterials = (materialsByCost.get(costId) ?? []).map((material) => ({
      id: String(material.id),
      sort_order: Number(material.sort_order),
      source_kind: String(material.source_kind),
      cost_basis: String(material.cost_basis),
      pricing_source: String(material.pricing_source),
      material_id: (material.material_id as string | null) ?? null,
      material_supplier_product_id:
        (material.material_supplier_product_id as string | null) ?? null,
      material_price_id: (material.material_price_id as string | null) ?? null,
      material_name: (material.material_name as string | null) ?? null,
      supplier_name: (material.supplier_name as string | null) ?? null,
      purchase_unit: (material.purchase_unit as string | null) ?? null,
      snapshotted_rate: material.snapshotted_rate as number | string | null,
      finished_width_mm: material.finished_width_mm as number | string | null,
      finished_height_mm: material.finished_height_mm as number | string | null,
      quantity: material.quantity as number | string | null,
      inherit_dimensions: (material.inherit_dimensions as boolean | null) ?? null,
      inherit_quantity: (material.inherit_quantity as boolean | null) ?? null,
      manual_material_cost: material.manual_material_cost as number | string | null,
    }));

    drafts.set(
      String(cost.quote_item_id),
      costDraftFromSnapshot({
        summary: {
          id: costId,
          cost_kind: String(cost.cost_kind),
          cost_basis: (cost.cost_basis as string | null) ?? null,
          material_id: (cost.material_id as string | null) ?? null,
          material_supplier_product_id:
            (cost.material_supplier_product_id as string | null) ?? null,
          material_price_id: (cost.material_price_id as string | null) ?? null,
          material_name: (cost.material_name as string | null) ?? null,
          supplier_name: (cost.supplier_name as string | null) ?? null,
          rate_per_sqm: cost.rate_per_sqm as number | string | null,
          finished_width_mm: cost.finished_width_mm as number | string | null,
          finished_height_mm: cost.finished_height_mm as number | string | null,
          quantity: cost.quantity as number | string | null,
          manual_material_cost: cost.manual_material_cost as number | string | null,
          default_finished_width_mm: cost.default_finished_width_mm as number | string | null,
          default_finished_height_mm: cost.default_finished_height_mm as number | string | null,
        },
        materials: savedMaterials,
        components: savedComponents,
      })
    );
  }

  return drafts;
}
