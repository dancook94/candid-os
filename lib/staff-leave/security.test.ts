import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration blocks session GUC bypass and self-approval", async () => {
  const sql = await readFile(
    new URL("../../supabase/migrations/20270110120000_staff_leave_phase1.sql", import.meta.url),
    "utf8"
  );

  assert.match(sql, /staff_leave_block_direct_client_write/);
  assert.doesNotMatch(sql, /staff_leave\.internal_write/);
  assert.match(sql, /Approvers cannot decide their own leave request/);
  assert.match(sql, /staff_absence_sickness_admin_select/);
  assert.doesNotMatch(sql, /staff_absence_sickness_select/);
  assert.match(sql, /list_staff_absence_sickness_own/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.staff_leave_block_direct_client_write\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /staff_leave_assert_profile_access/);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.staff_leave_entitlement_days/);
});

test("gifted closures do not add to reserved pool SQL filter", async () => {
  const sql = await readFile(
    new URL("../../supabase/migrations/20270110120000_staff_leave_phase1.sql", import.meta.url),
    "utf8"
  );

  assert.match(sql, /closure_kind = 'compulsory_leave'/);
  assert.match(sql, /paid_gift/);
});
