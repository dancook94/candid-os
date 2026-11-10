import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110163000_installation_management_phase1.sql",
  import.meta.url
);

const OPERATIONAL_RPCS = [
  "installation_visit_operational_progress",
  "installation_snag_upsert",
  "installation_sign_off_capture",
  "installation_register_visit_document",
  "installation_register_visit_photo",
] as const;

const MANAGER_RPCS = [
  "installation_reconcile_for_job",
  "installation_project_create_manual",
  "installation_visit_create_admin",
  "installation_visit_admin_schedule",
  "installation_visit_assign_profile",
] as const;

test("installation migration defines unique job project constraint", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /installation_projects_job_id_unique_idx/);
  assert.match(sql, /installation_visits_unique_number/);
});

test("operational RPC blocks administrative statuses", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /Installers cannot set administrative visit statuses/);
  assert.match(sql, /installation_assert_operator/);
});

test("manager RPCs require installation_assert_manager", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  for (const rpc of MANAGER_RPCS) {
    const block = sql.match(
      new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${rpc}[\\s\\S]*?installation_assert_manager\\(\\)`
      )
    );
    assert.ok(block, `${rpc} must call installation_assert_manager`);
  }
});

test("sign-off and visit events are guarded", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /installation_visit_events_prevent_mutation/);
  assert.match(sql, /installation_sign_offs_prevent_mutation/);
  assert.match(sql, /Direct client writes are not permitted/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.installation_append_visit_event/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.installation_version_requires_project/);
});

test("authenticated clients receive execute grants on RPCs only", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  for (const rpc of [...OPERATIONAL_RPCS, ...MANAGER_RPCS]) {
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}`));
  }
});
