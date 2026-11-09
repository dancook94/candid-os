import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PATTERNS = new URL(
  "../../supabase/migrations/20270110150000_staff_leave_patterns_additional_paid.sql",
  import.meta.url
);
const PHASE1 = new URL(
  "../../supabase/migrations/20270110120000_staff_leave_phase1.sql",
  import.meta.url
);

test("patterns migration keeps distinct RPC signatures from phase 1", async () => {
  const patterns = await readFile(PATTERNS, "utf8");
  const phase1 = await readFile(PHASE1, "utf8");

  assert.match(phase1, /submit_staff_leave_request\(date, date, text, text\)/);
  assert.match(patterns, /submit_staff_additional_paid_leave_request\(date, date, text, text\)/);
  assert.match(patterns, /set_staff_working_pattern\(\s*uuid,\s*date,/);
  assert.doesNotMatch(patterns, /CREATE OR REPLACE FUNCTION public\.staff_leave_balance\(/);
});

test("admin-only guards wrap entitlement and pattern mutations", async () => {
  const sql = await readFile(PATTERNS, "utf8");

  assert.match(sql, /set_staff_working_pattern[\s\S]*is_approved_candid_admin\(\)/);
  assert.match(sql, /set_staff_leave_entitlement[\s\S]*is_approved_candid_admin\(\)/);
  assert.match(sql, /grant_staff_additional_paid_leave[\s\S]*is_approved_candid_admin\(\)/);
  assert.match(sql, /staff_working_patterns_reject_direct_write/);
  assert.match(sql, /staff_leave_entitlements_reject_direct_write/);
});

test("annual balance path excludes additional paid at SQL layer", async () => {
  const sql = await readFile(PATTERNS, "utf8");
  assert.match(sql, /staff_leave_used_days[\s\S]*leave_kind = 'annual'/);
});
