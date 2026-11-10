import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PHASE1 = new URL(
  "../../supabase/migrations/20270110163000_installation_management_phase1.sql",
  import.meta.url
);
const HARDENING = new URL(
  "../../supabase/migrations/20270110164000_installation_phase1_hardening.sql",
  import.meta.url
);
const REPAIR = new URL(
  "../../supabase/migrations/20270110165000_installation_phase1_hardening_repair.sql",
  import.meta.url
);
const VERIFY_REPAIR = new URL(
  "../../scripts/verify-installation-phase1-hardening-repair.sql",
  import.meta.url
);

const HARDENING_FUNCTIONS = [
  "installation_storage_visit_id_from_path",
  "installation_storage_path_is_valid",
  "installation_visit_exists",
  "installation_register_visit_document",
  "installation_register_visit_photo",
  "installation_visit_operational_progress",
  "installation_visit_manager_reopen",
  "installation_snag_upsert",
] as const;

function assertDefinedInMigration(sql: string, name: string) {
  assert.match(
    sql,
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, "m"),
    `${name} must be CREATE OR REPLACE in migration`
  );
}

function hardeningBody(sql: string) {
  const begin = sql.indexOf("BEGIN;");
  const commit = sql.lastIndexOf("COMMIT;");
  assert.ok(begin >= 0 && commit > begin);
  return sql.slice(begin, commit + "COMMIT;".length);
}

test("164000 defines all hardening functions in public schema", async () => {
  const sql = await readFile(HARDENING, "utf8");
  for (const name of HARDENING_FUNCTIONS) {
    assertDefinedInMigration(sql, name);
  }
});

test("165000 repair re-applies full 164000 transaction body", async () => {
  const original = await readFile(HARDENING, "utf8");
  const repair = await readFile(REPAIR, "utf8");
  assert.equal(hardeningBody(original), hardeningBody(repair));
});

test("manager reopen GRANT uses three-arg types like other phase-1 RPCs with defaults", async () => {
  const phase1 = await readFile(PHASE1, "utf8");
  const repair = await readFile(REPAIR, "utf8");

  assert.match(
    phase1,
    /GRANT EXECUTE ON FUNCTION public\.installation_visit_create_admin\(uuid, text, text\)/
  );
  assert.match(
    repair,
    /GRANT EXECUTE ON FUNCTION public\.installation_visit_manager_reopen\(uuid, text, text\) TO authenticated;/
  );

  const grantIdx = repair.indexOf(
    "GRANT EXECUTE ON FUNCTION public.installation_visit_manager_reopen"
  );
  const snagIdx = repair.indexOf(
    "CREATE OR REPLACE FUNCTION public.installation_snag_upsert"
  );
  assert.ok(grantIdx > 0 && snagIdx > grantIdx, "GRANT must follow CREATE reopen");
});

test("repair migration is SQL Editor safe", async () => {
  const sql = await readFile(REPAIR, "utf8");
  assert.doesNotMatch(sql, /\\set\s/i);
  assert.doesNotMatch(sql, /^\\[a-z]/im);
  assert.match(sql, /^BEGIN;\s*$/m);
  assert.match(sql, /^COMMIT;\s*$/m);
});

test("hardening storage policies reject invalid paths and orphaned uploads", async () => {
  const sql = await readFile(REPAIR, "utf8");
  assert.match(sql, /installation_storage_path_is_valid\(name\)/);
  assert.match(sql, /installation_visit_exists\(/);
  assert.match(sql, /installation_storage_visit_id_from_path\(name\)/);
});

test("hardening blocks operational edits on terminal visits", async () => {
  const sql = await readFile(REPAIR, "utf8");
  const operational = sql.match(
    /CREATE OR REPLACE FUNCTION public\.installation_visit_operational_progress\([\s\S]*?\$\$;/m
  )?.[0];
  assert.ok(operational);
  assert.match(operational, /Completed or cancelled visits cannot be changed/);

  const snag = sql.match(
    /CREATE OR REPLACE FUNCTION public\.installation_snag_upsert\([\s\S]*?\$\$;/m
  )?.[0];
  assert.ok(snag);
  assert.match(snag, /Cannot modify snagging on completed or cancelled visits/);
});

test("installation_visit_manager_reopen enforces manager, reason and audit event", async () => {
  const sql = await readFile(REPAIR, "utf8");
  const block = sql.match(
    /CREATE OR REPLACE FUNCTION public\.installation_visit_manager_reopen\([\s\S]*?\$\$;/m
  )?.[0];

  assert.ok(block, "installation_visit_manager_reopen definition missing");
  assert.match(block, /installation_assert_manager\(\)/);
  assert.match(block, /Reopen reason is required/);
  assert.match(block, /'visit_reopened'/);
  assert.match(block, /FOR UPDATE/);
  assert.match(block, /installation_append_visit_event/);
});

test("post-repair verification script checks all four missing helpers", async () => {
  const sql = await readFile(VERIFY_REPAIR, "utf8");
  for (const fn of [
    "installation_storage_visit_id_from_path",
    "installation_storage_path_is_valid",
    "installation_visit_exists",
    "installation_visit_manager_reopen",
  ]) {
    assert.match(sql, new RegExp(fn));
  }
  assert.match(sql, /to_regprocedure\('public\.installation_visit_manager_reopen\(uuid, text, text\)'\)/);
});
