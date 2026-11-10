import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const GRANTS = new URL(
  "../../supabase/migrations/20270110166000_installation_phase1_table_select_grants.sql",
  import.meta.url
);

const TABLES = [
  "installation_projects",
  "installation_visits",
  "installation_visit_assignments",
  "installation_visit_documents",
  "installation_visit_photos",
  "installation_snag_items",
  "installation_sign_offs",
  "installation_visit_events",
] as const;

test("166000 grants SELECT only to authenticated on installation tables", async () => {
  const sql = await readFile(GRANTS, "utf8");
  for (const table of TABLES) {
    assert.match(
      sql,
      new RegExp(
        `GRANT SELECT ON TABLE public\\.${table} TO authenticated;`
      )
    );
  }
  assert.doesNotMatch(sql, /GRANT INSERT/i);
  assert.doesNotMatch(sql, /GRANT UPDATE/i);
  assert.doesNotMatch(sql, /GRANT DELETE/i);
});
