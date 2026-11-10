import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110167000_installation_phase1_rls_helper_grants.sql",
  import.meta.url
);

const HELPERS = [
  "is_approved_installation_reader",
  "is_approved_installation_operator",
  "is_approved_installation_manager",
  "storage_installation_visit_id_from_path",
] as const;

test("167000 grants EXECUTE on RLS helpers to authenticated only", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  for (const fn of HELPERS) {
    const arg = fn === "storage_installation_visit_id_from_path" ? "(text)" : "()";
    assert.match(
      sql,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}${arg.replace("(", "\\(").replace(")", "\\)")} TO authenticated;`)
    );
  }
  assert.doesNotMatch(sql, /GRANT INSERT/i);
  assert.doesNotMatch(sql, /GRANT SELECT ON TABLE/i);
  assert.doesNotMatch(sql, /installation_assert_reader/);
});
