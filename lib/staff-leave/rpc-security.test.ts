import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110120000_staff_leave_phase1.sql",
  import.meta.url
);

const PUBLIC_RPCS = [
  "submit_staff_leave_request",
  "decide_staff_leave_request",
  "cancel_staff_leave_request",
  "record_staff_absence_sickness",
  "list_staff_absence_sickness_own",
  "list_staff_absence_sickness_admin",
  "staff_absence_sickness_year_total",
  "staff_leave_balance",
] as const;

const INTERNAL_RPCS = [
  "staff_leave_assert_profile_access",
  "staff_leave_entitlement_days",
  "staff_leave_used_days",
  "staff_leave_pattern_for_profile",
  "staff_leave_is_working_day",
  "staff_leave_is_reserved_day",
  "staff_leave_count_request_days",
  "staff_leave_reserved_pool_days",
  "staff_leave_block_direct_client_write",
] as const;

test("staff_leave_balance input arg name does not shadow RETURNS TABLE columns", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const balanceBlock = sql.match(
    /CREATE OR REPLACE FUNCTION public\.staff_leave_balance\([\s\S]*?\$\$;/
  )?.[0];

  assert.ok(balanceBlock);
  assert.match(balanceBlock, /p_holiday_year integer/);
});

test("staff_leave_balance enforces self or admin access", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /staff_leave_assert_profile_access/);
  assert.match(
    sql,
    /PERFORM public\.staff_leave_assert_profile_access\(target_profile\);/
  );
  assert.match(sql, /target_profile IS DISTINCT FROM actor/);
  assert.match(sql, /NOT public\.is_approved_candid_admin\(\)/);
});

test("entitlement_days is not directly callable by authenticated clients", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.staff_leave_entitlement_days/);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.staff_leave_entitlement_days\(uuid, integer, boolean\) FROM PUBLIC, anon, authenticated/
  );
  assert.match(sql, /skip_access_check boolean DEFAULT false/);
});

test("internal helpers are not granted to authenticated", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  for (const name of INTERNAL_RPCS) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`));
  }
});

test("only expected RPCs are granted to authenticated", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const cancelSql = await readFile(
    new URL(
      "../../supabase/migrations/20270110140000_staff_leave_cancellation.sql",
      import.meta.url
    ),
    "utf8"
  );
  const grants = [
    ...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)/g),
    ...cancelSql.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)/g),
  ].map((m) => m[1]);

  for (const rpc of PUBLIC_RPCS) {
    assert.ok(grants.includes(rpc), `missing grant for ${rpc}`);
  }

  for (const internal of INTERNAL_RPCS) {
    assert.equal(
      grants.includes(internal),
      false,
      `${internal} should not be granted to authenticated`
    );
  }
});

test("cancel_staff_leave_request is granted only on the cancellation migration", async () => {
  const phase1 = await readFile(MIGRATION, "utf8");
  const cancelSql = await readFile(
    new URL(
      "../../supabase/migrations/20270110140000_staff_leave_cancellation.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.doesNotMatch(phase1, /cancel_staff_leave_request/);
  assert.match(cancelSql, /GRANT EXECUTE ON FUNCTION public\.cancel_staff_leave_request/);
  assert.match(cancelSql, /REVOKE ALL ON FUNCTION public\.cancel_staff_leave_request/);
});

test("mutation RPCs enforce role checks in SQL", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const cancelSql = await readFile(
    new URL(
      "../../supabase/migrations/20270110140000_staff_leave_cancellation.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /submit_staff_leave_request[\s\S]*is_approved_staff\(\)/);
  assert.match(sql, /decide_staff_leave_request[\s\S]*is_approved_candid_admin\(\)/);
  assert.match(cancelSql, /cancel_staff_leave_request[\s\S]*is_approved_staff\(\)/);
  assert.match(cancelSql, /cancel_staff_leave_request[\s\S]*is_approved_candid_admin\(\)/);
  assert.match(sql, /record_staff_absence_sickness[\s\S]*is_approved_candid_admin\(\)/);
  assert.match(sql, /list_staff_absence_sickness_admin[\s\S]*is_approved_candid_admin\(\)/);
  assert.match(sql, /list_staff_absence_sickness_own[\s\S]*is_approved_staff\(\)/);
});

test("direct table writes remain blocked for authenticated", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.staff_leave_requests FROM authenticated/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.staff_leave_request_events FROM authenticated/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.staff_absence_sickness FROM authenticated/);
});

test("every SECURITY DEFINER function sets search_path", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const blocks = sql.split(/CREATE OR REPLACE FUNCTION public\./).slice(1);

  for (const block of blocks) {
    if (!/SECURITY DEFINER/.test(block)) {
      continue;
    }
    const name = block.match(/^(\w+)/)?.[1] ?? "unknown";
    assert.match(block, /SET search_path = public/, `missing search_path on ${name}`);
  }
});

test("migration does not touch Gmail schema", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.doesNotMatch(sql, /gmail_/i);
});

test("admin balance API delegates access control to staff_leave_balance RPC", async () => {
  const source = await readFile(
    new URL("../../app/api/admin/leave/balance/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /canDecideLeaveRequests/);
  assert.match(source, /staff_leave_balance/);
  assert.match(source, /p_holiday_year/);
});

test("staff balance API uses authenticated profile only", async () => {
  const source = await readFile(
    new URL("../../app/api/staff/leave/balance/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /auth\.userId/);
  assert.match(source, /staff_leave_balance/);
  assert.match(source, /p_holiday_year/);
});
