import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
    }
  }
}

function compareIsoDesc(left: string, right: string) {
  return right.localeCompare(left);
}

function selectCurrentApprovedPrice(
  prices: Array<{
    id: string;
    price: number;
    priceUnit: string;
    effectiveDate: string;
    approvedAt: string;
    createdAt: string;
  }>
) {
  if (prices.length === 0) return null;
  return [...prices].sort((left, right) => {
    const byDate = compareIsoDesc(left.effectiveDate, right.effectiveDate);
    if (byDate !== 0) return byDate;
    const byApproval = compareIsoDesc(left.approvedAt, right.approvedAt);
    if (byApproval !== 0) return byApproval;
    return compareIsoDesc(left.createdAt, right.createdAt);
  })[0];
}

const BASELINE = {
  quoteId: "45202ec9-bcd7-4194-973d-4f9712ba11ab",
  v1: "0881e392-5850-4f5c-bac8-5b97d1245df4",
  v2: "183df478-9781-41d8-be0a-506362e6e2e8",
  foamPriceId: "f234941d-6d4c-486f-8fb5-95c5484b1494",
  productId: "6305aab4-0c23-4712-a972-55be9d0b77f6",
  materialId: "d9fd0a24-14b9-4043-8a80-282f42f32ff8",
  snapshottedRate: 8.7335,
  foamCost: 96.07,
  totalCost: 296.07,
  materialCost: 116.07,
  additionalCost: 180,
  inkPriceId: "fdaccb94-b07b-4e51-b42c-f45bfe41bb1b",
  inkRate: 2,
  inkCost: 20,
  labour: 80,
  oneOff: 100,
};

const TEST_PRICE = {
  price: 10,
  currency: "GBP",
  priceUnit: "square_metre",
  effectiveDate: "2026-11-07",
  sourceType: "manual",
  sourceReference: "test-historical-pricing-2026-11-07",
  approvedBy: "54e62cc9-9452-4504-82a5-008e51e86ab7",
};

type RowResult = { pass: boolean; detail: string };

async function readVersion(sb: SupabaseClient, versionId: string) {
  const { data: version } = await sb
    .from("quote_versions")
    .select("version_number, version_status")
    .eq("id", versionId)
    .single();
  const { data: items } = await sb
    .from("quote_items")
    .select("id, title, quantity, unit_price")
    .eq("quote_version_id", versionId)
    .order("sort_order");
  const item = items?.[0];
  if (!item) return null;

  const { data: cost } = await sb
    .from("quote_item_costs")
    .select("id, material_cost, total_estimated_cost, additional_cost")
    .eq("quote_item_id", item.id)
    .maybeSingle();
  if (!cost) return { version, item, cost: null, mats: [], comps: [] };

  const { data: mats } = await sb
    .from("quote_item_material_components")
    .select(
      "id, material_name, snapshotted_rate, material_price_id, material_cost, source_kind, cost_basis, pricing_source, material_id, material_supplier_product_id, supplier_name, purchase_unit, finished_width_mm, finished_height_mm, quantity, inherit_dimensions, inherit_quantity, wastage_rate, sort_order"
    )
    .eq("quote_item_cost_id", cost.id)
    .order("sort_order");
  const { data: comps } = await sb
    .from("quote_item_cost_components")
    .select("component_type, description, quantity, unit_cost, line_total, sort_order")
    .eq("quote_item_cost_id", cost.id)
    .order("sort_order");

  return { version, item, cost, mats: mats ?? [], comps: comps ?? [] };
}

function assertVersionUnchanged(
  label: string,
  row: Awaited<ReturnType<typeof readVersion>>
): RowResult {
  if (!row?.cost) return { pass: false, detail: `${label}: no cost row` };
  const foam = row.mats.find((m) => (m.material_name ?? "").includes("Foamalite"));
  const ink = row.mats.find((m) => (m.material_name ?? "").includes("Ink"));
  const labour = row.comps.find((c) => c.component_type === "labour");
  const oneOff = row.comps.find((c) => c.component_type === "one_off");

  const checks: Array<[unknown, unknown, string]> = [
    [Number(foam?.snapshotted_rate), BASELINE.snapshottedRate, "foam rate"],
    [foam?.material_price_id, BASELINE.foamPriceId, "foam price id"],
    [Number(foam?.material_cost), BASELINE.foamCost, "foam cost"],
    [Number(ink?.snapshotted_rate), BASELINE.inkRate, "ink rate"],
    [ink?.material_price_id, BASELINE.inkPriceId, "ink price id"],
    [Number(ink?.material_cost), BASELINE.inkCost, "ink cost"],
    [Number(labour?.line_total), BASELINE.labour, "labour"],
    [Number(oneOff?.line_total), BASELINE.oneOff, "one-off"],
    [Number(row.cost.total_estimated_cost), BASELINE.totalCost, "total"],
    [Number(row.cost.material_cost), BASELINE.materialCost, "material total"],
    [Number(row.cost.additional_cost), BASELINE.additionalCost, "additional"],
  ] as const;

  for (const [actual, expected, name] of checks) {
    if (actual !== expected) {
      return { pass: false, detail: `${label}: ${name} expected ${expected}, got ${actual}` };
    }
  }

  return { pass: true, detail: `${label} unchanged` };
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes("axhkdwgmwhlbsstumndh")) {
    console.error("ABORT: not Test Supabase");
    process.exit(1);
  }

  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const results: Record<string, RowResult> = {};

  const beforeV1 = await readVersion(sb, BASELINE.v1);
  const beforeV2 = await readVersion(sb, BASELINE.v2);
  results.baseline_v1 = assertVersionUnchanged("Q-1 v1 pre-insert", beforeV1);
  results.baseline_v2 = assertVersionUnchanged("Q-1 v2 pre-insert", beforeV2);
  if (!results.baseline_v1.pass || !results.baseline_v2.pass) {
    console.log(JSON.stringify({ results }, null, 2));
    process.exit(2);
  }

  const { data: existing } = await sb
    .from("material_prices")
    .select("id")
    .eq("material_supplier_product_id", BASELINE.productId)
    .eq("source_reference", TEST_PRICE.sourceReference)
    .maybeSingle();

  let newPriceId = existing?.id ?? null;
  if (!newPriceId) {
    const { data, error } = await sb
      .from("material_prices")
      .insert({
        material_supplier_product_id: BASELINE.productId,
        price: TEST_PRICE.price,
        currency: TEST_PRICE.currency,
        price_unit: TEST_PRICE.priceUnit,
        effective_date: TEST_PRICE.effectiveDate,
        approved_by: TEST_PRICE.approvedBy,
        source_type: TEST_PRICE.sourceType,
        source_reference: TEST_PRICE.sourceReference,
      })
      .select("id")
      .single();
    if (error) {
      console.error("INSERT_FAILED", error);
      process.exit(1);
    }
    newPriceId = data.id;
  }

  const { data: productPrices } = await sb
    .from("material_prices")
    .select("id, price, price_unit, effective_date, approved_at, created_at")
    .eq("material_supplier_product_id", BASELINE.productId);
  const current = selectCurrentApprovedPrice(
    (productPrices ?? []).map((p) => ({
      id: p.id,
      price: Number(p.price),
      priceUnit: p.price_unit,
      effectiveDate: p.effective_date,
      approvedAt: p.approved_at,
      createdAt: p.created_at,
    }))
  );

  const catalogueOk =
    current?.id === newPriceId &&
    current.price === 10 &&
    current.priceUnit === "square_metre";
  results.catalogue_current_10_sqm = {
    pass: catalogueOk,
    detail: catalogueOk
      ? `current price ${newPriceId} @ £10/m² (${productPrices?.length} rows)`
      : `current=${JSON.stringify(current)} new=${newPriceId}`,
  };

  const afterV1 = await readVersion(sb, BASELINE.v1);
  const afterV2 = await readVersion(sb, BASELINE.v2);
  results.q1_v1_after_price_insert = assertVersionUnchanged("Q-1 v1 post-insert", afterV1);
  results.q1_v2_after_price_insert = assertVersionUnchanged("Q-1 v2 post-insert", afterV2);

  // New quote behaviour: same selection logic the quote builder uses when picking catalogue.
  results.new_quote_would_use_current = results.catalogue_current_10_sqm;

  // Duplicate version (DB function; requires admin JWT — may fail under service role).
  let v3Id: string | null = null;
  const { data: dupId, error: dupErr } = await sb.rpc("duplicate_quote_version", {
    p_source_version_id: BASELINE.v2,
  });

  if (dupErr) {
    results.duplicate_version_rpc = {
      pass: false,
      detail: `RPC blocked (${dupErr.message}). v3 copy checks skipped — verify in UI.`,
    };
  } else {
    v3Id = String(dupId);
    const v3 = await readVersion(sb, v3Id);
    const foam = v3?.mats.find((m) => (m.material_name ?? "").includes("Foamalite"));
    const copied =
      Number(foam?.snapshotted_rate) === BASELINE.snapshottedRate &&
      foam?.material_price_id === BASELINE.foamPriceId;
    results.v3_copies_historical_rate = {
      pass: copied,
      detail: copied
        ? `v${v3?.version?.version_number} foam snapshot ${foam?.snapshotted_rate}`
        : JSON.stringify(foam),
    };

    // Refresh foam on v3 via save_composite_quote_line_cost
    if (v3?.cost && v3.item) {
      const materialsPayload = v3.mats.map((m) => {
        const isFoam = (m.material_name ?? "").includes("Foamalite");
        return {
          ...(isFoam ? {} : { id: m.id }),
          source_kind: m.source_kind,
          cost_basis: m.cost_basis,
          use_current_rate: isFoam,
          material_id: m.material_id,
          material_supplier_product_id: m.material_supplier_product_id,
          material_price_id: isFoam ? newPriceId : m.material_price_id,
          material_name: m.material_name,
          supplier_name: m.supplier_name,
          purchase_unit: m.purchase_unit,
          inherit_dimensions: m.inherit_dimensions,
          inherit_quantity: m.inherit_quantity,
          finished_width_mm: m.finished_width_mm,
          finished_height_mm: m.finished_height_mm,
          quantity: m.quantity,
          ...(m.wastage_rate != null ? { wastage_rate: m.wastage_rate } : {}),
        };
      });
      const componentsPayload = v3.comps.map((c) => ({
        component_type: c.component_type,
        description: c.description,
        quantity: c.quantity,
        unit_cost: c.unit_cost,
      }));

      const existingMaterials = v3.mats.map((m) => ({
        id: m.id,
        quote_item_cost_id: v3.cost!.id,
        sort_order: m.sort_order,
        source_kind: m.source_kind,
        cost_basis: m.cost_basis,
        pricing_source: m.pricing_source,
        material_id: m.material_id,
        material_supplier_product_id: m.material_supplier_product_id,
        material_price_id: m.material_price_id,
        material_name: m.material_name,
        supplier_name: m.supplier_name,
        purchase_unit: m.purchase_unit,
        snapshotted_rate: m.snapshotted_rate,
        finished_width_mm: m.finished_width_mm,
        finished_height_mm: m.finished_height_mm,
        quantity: m.quantity,
        inherit_dimensions: m.inherit_dimensions,
        inherit_quantity: m.inherit_quantity,
        wastage_rate: m.wastage_rate,
      }));

      const { error: saveErr } = await sb.rpc("save_composite_quote_line_cost", {
        p_item_id: v3.item.id,
        p_line_quantity: v3.item.quantity,
        p_line_sort: 1,
        p_cost: {
          materials: materialsPayload,
          components: componentsPayload,
        },
        p_existing_materials: existingMaterials,
      });

      if (saveErr) {
        results.v3_refresh_foam_save = {
          pass: false,
          detail: `save RPC blocked (${saveErr.message}). Verify refresh in UI on v${v3.version?.version_number}.`,
        };
      } else {
        const v3After = await readVersion(sb, v3Id);
        const foamAfter = v3After?.mats.find((m) => (m.material_name ?? "").includes("Foamalite"));
        const refreshed =
          Number(foamAfter?.snapshotted_rate) === 10 &&
          foamAfter?.material_price_id === newPriceId;
        results.v3_refresh_foam_save = {
          pass: refreshed,
          detail: refreshed
            ? `v${v3After?.version?.version_number} foam rate ${foamAfter?.snapshotted_rate}, cost ${foamAfter?.material_cost}`
            : JSON.stringify(foamAfter),
        };
        results.q1_v1_after_v3_refresh = assertVersionUnchanged("Q-1 v1 after v3 refresh", await readVersion(sb, BASELINE.v1));
        results.q1_v2_after_v3_refresh = assertVersionUnchanged("Q-1 v2 after v3 refresh", await readVersion(sb, BASELINE.v2));
      }
    }
  }

  const oldPriceStillThere = (productPrices ?? []).some((p) => p.id === BASELINE.foamPriceId);
  results.old_price_retained = {
    pass: oldPriceStillThere && (productPrices?.length ?? 0) >= 2,
    detail: `${productPrices?.length} price rows; old id present=${oldPriceStillThere}`,
  };

  console.log(
    JSON.stringify(
      {
        newPriceId,
        results,
        summary: Object.fromEntries(
          Object.entries(results).map(([key, value]) => [key, value.pass ? "PASS" : "FAIL"])
        ),
      },
      null,
      2
    )
  );

  const failed = Object.values(results).some((r) => !r.pass);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
