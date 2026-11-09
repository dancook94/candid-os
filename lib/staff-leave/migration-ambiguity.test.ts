import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MAIN = new URL(
  "../../supabase/migrations/20270110120000_staff_leave_phase1.sql",
  import.meta.url
);
const HOTFIX = new URL(
  "../../supabase/migrations/20270110130000_staff_leave_holiday_year_ambiguity_fix.sql",
  import.meta.url
);

test("reserved_pool_days qualifies holiday year parameter", async () => {
  const sql = await readFile(MAIN, "utf8");
  const block = sql.match(
    /CREATE OR REPLACE FUNCTION public\.staff_leave_reserved_pool_days\([\s\S]*?\$\$;/
  )?.[0];

  assert.ok(block);
  assert.match(block, /p_holiday_year integer/);
  assert.match(block, /bh\.holiday_year = p_holiday_year/);
  assert.match(block, /cc\.holiday_year = p_holiday_year/);
  assert.doesNotMatch(block, /bh\.holiday_year = holiday_year/);
});

test("entitlement_days qualifies holiday year parameter", async () => {
  const sql = await readFile(MAIN, "utf8");
  const block = sql.match(
    /CREATE OR REPLACE FUNCTION public\.staff_leave_entitlement_days\([\s\S]*?\$\$;/
  )?.[0];

  assert.ok(block);
  assert.match(block, /p_holiday_year integer/);
  assert.match(block, /py\.holiday_year = p_holiday_year/);
  assert.doesNotMatch(block, /py\.holiday_year = holiday_year/);
});

test("hotfix migration replaces ambiguous helper functions", async () => {
  const sql = await readFile(HOTFIX, "utf8");
  assert.match(sql, /staff_leave_reserved_pool_days/);
  assert.match(sql, /staff_leave_entitlement_days/);
  assert.match(sql, /p_holiday_year integer/);
});
