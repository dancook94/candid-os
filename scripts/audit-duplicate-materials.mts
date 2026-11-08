import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const sb = createClient(
  env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)![1].trim(),
  env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)![1].trim()
);

const { data: materials } = await sb.from("materials").select("*").eq("active", true);
const { data: products } = await sb
  .from("material_supplier_products")
  .select("*, suppliers(name)")
  .eq("active", true)
  .eq("is_preferred", true);
const { data: prices } = await sb
  .from("material_prices")
  .select("material_supplier_product_id, price, price_unit, approved_at")
  .not("approved_at", "is", null);

const priceByProd = new Map<string, (typeof prices)[number]>();
for (const row of prices ?? []) {
  const current = priceByProd.get(row.material_supplier_product_id);
  if (!current || String(row.approved_at) > String(current.approved_at)) {
    priceByProd.set(row.material_supplier_product_id, row);
  }
}

function phys(m: (typeof materials)[number]) {
  return [
    m.category,
    m.thickness_mm,
    m.colour,
    m.finish,
    m.purchase_unit,
    m.purchase_width_mm,
    m.purchase_height_mm,
    m.purchase_length_mm,
    m.costing_unit,
    m.costing_pack_quantity,
  ].join("|");
}

const entries = [];
for (const m of materials ?? []) {
  const pref = products?.find((p) => p.material_id === m.id);
  if (!pref) continue;
  const pr = priceByProd.get(pref.id);
  entries.push({
    phys: phys(m),
    materialId: m.id,
    name: m.name,
    supplier: (pref.suppliers as { name: string })?.name,
    price: pr?.price,
    priceUnit: pr?.price_unit,
  });
}

const clusters = new Map<string, typeof entries>();
for (const e of entries) {
  const key = `${e.phys}||${e.supplier}||${e.price}||${e.priceUnit}`;
  const c = clusters.get(key) ?? [];
  c.push(e);
  clusters.set(key, c);
}

const dupes = [...clusters.values()].filter((c) => c.length > 1);
console.log(JSON.stringify({ duplicateClusters: dupes.length, dupes }, null, 2));
process.exit(dupes.length > 0 ? 1 : 0);
