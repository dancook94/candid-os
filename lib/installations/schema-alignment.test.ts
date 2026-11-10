import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110163000_installation_management_phase1.sql",
  import.meta.url
);

test("installation detection joins cost components via quote_item_costs", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /JOIN public\.quote_item_costs qic/);
  assert.match(sql, /ON qic\.quote_item_id = qi\.id/);
  assert.match(sql, /ON cc\.quote_item_cost_id = qic\.id/);
  assert.doesNotMatch(sql, /cc\.quote_item_id/);
});

test("load-quote-costs pattern matches installation signal loader", async () => {
  const loader = await readFile(
    new URL("./load-quote-installation-signals.ts", import.meta.url),
    "utf8"
  );
  assert.match(loader, /quote_item_cost_id/);
  assert.match(loader, /from\("quote_item_costs"\)/);
  assert.match(
    loader,
    /\.from\("quote_item_cost_components"\)\s*\n\s*\.select\("quote_item_cost_id, component_type"\)/
  );
});
