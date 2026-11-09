import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staff leave phase 1 migration enforces RPC-only mutations and duplicate-safe approval", async () => {
  const sql = await readFile(
    new URL("../../supabase/migrations/20270110120000_staff_leave_phase1.sql", import.meta.url),
    "utf8"
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.staff_leave_requests/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.staff_absence_sickness/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.staff_leave_request_events/);
  assert.match(sql, /submit_staff_leave_request/);
  assert.match(sql, /decide_staff_leave_request/);
  assert.match(sql, /'cancelled'/);
  assert.match(sql, /record_staff_absence_sickness/);
  assert.match(sql, /AND r\.status = 'pending'/);
  assert.match(sql, /staff_leave_block_direct_client_write/);
  assert.match(sql, /closure_kind/);
  assert.match(sql, /2027-12-24/);
  assert.match(sql, /2028-01-03/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.staff_leave_requests FROM authenticated/);
  assert.match(sql, /Leave approval history is append-only/);
  assert.match(sql, /2027-01-01/);
  assert.match(sql, /2027-12-28/);
  assert.match(sql, /paid_gift/);
  assert.match(sql, /Approvers cannot decide their own leave request/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_staff_leave_request/);
  assert.match(sql, /public\.is_approved_staff\(\)/);
  assert.match(sql, /public\.is_approved_candid_admin\(\)/);
});

test("admin decide route maps duplicate decisions to HTTP 409", async () => {
  const source = await readFile(
    new URL("../../app/api/admin/leave/requests/[id]/decide/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /\? 409/);
  assert.match(source, /decide_staff_leave_request/);
});
