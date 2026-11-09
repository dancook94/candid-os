import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
const STUBS = new URL("./migration-compile.stubs.sql", import.meta.url);
const PHASE1_AMBIGUOUS_HELPERS = new URL(
  "./fixtures/phase1-ambiguous-helpers.sql",
  import.meta.url
);

test("reserved_pool_days keeps holiday_year argument and uses v_holiday_year locally", async () => {
  const sql = await readFile(MAIN, "utf8");
  const block = sql.match(
    /CREATE OR REPLACE FUNCTION public\.staff_leave_reserved_pool_days\([\s\S]*?\$\$;/
  )?.[0];

  assert.ok(block);
  assert.match(block, /holiday_year integer/);
  assert.match(block, /v_holiday_year integer := holiday_year/);
  assert.match(block, /bh\.holiday_year = v_holiday_year/);
  assert.match(block, /cc\.holiday_year = v_holiday_year/);
  assert.doesNotMatch(block, /bh\.holiday_year = holiday_year[^;]/);
});

test("entitlement_days keeps holiday_year argument and uses v_holiday_year locally", async () => {
  const sql = await readFile(MAIN, "utf8");
  const block = sql.match(
    /CREATE OR REPLACE FUNCTION public\.staff_leave_entitlement_days\([\s\S]*?\$\$;/
  )?.[0];

  assert.ok(block);
  assert.match(block, /holiday_year integer/);
  assert.match(block, /v_holiday_year integer := holiday_year/);
  assert.match(block, /py\.holiday_year = v_holiday_year/);
  assert.doesNotMatch(block, /py\.holiday_year = holiday_year/);
});

test("hotfix does not rename function parameters", async () => {
  const sql = await readFile(HOTFIX, "utf8");

  assert.match(sql, /staff_leave_reserved_pool_days/);
  assert.match(sql, /staff_leave_entitlement_days/);
  assert.match(
    sql,
    /staff_leave_reserved_pool_days\(\s*target_profile uuid,\s*holiday_year integer\s*\)/
  );
  assert.match(
    sql,
    /staff_leave_entitlement_days\(\s*target_profile uuid,\s*holiday_year integer/
  );
  assert.doesNotMatch(sql, /p_holiday_year integer/);
  assert.doesNotMatch(sql, /DROP FUNCTION/i);
});

function dockerAvailable() {
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
}

test(
  "hotfix applies on top of Phase 1 ambiguous helper signatures",
  { skip: !dockerAvailable() },
  async () => {
    const stubsSql = await readFile(STUBS, "utf8");
    const ambiguousSql = await readFile(PHASE1_AMBIGUOUS_HELPERS, "utf8");
    const hotfixSql = await readFile(HOTFIX, "utf8");

    const containerName = `staff-leave-hotfix-${process.pid}`;
    const combined = `${stubsSql}\n${ambiguousSql}\n${hotfixSql}\nSELECT public.staff_leave_reserved_pool_days(gen_random_uuid(), 2027);\n`;

    try {
      execFileSync(
        "docker",
        [
          "run",
          "-d",
          "--name",
          containerName,
          "-e",
          "POSTGRES_PASSWORD=postgres",
          "postgres:16-alpine",
        ],
        { stdio: "pipe" }
      );

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const ready = spawnSync("docker", [
          "exec",
          containerName,
          "pg_isready",
          "-U",
          "postgres",
        ]);
        if (ready.status === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const apply = spawnSync(
        "docker",
        ["exec", "-i", containerName, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
        { input: combined, encoding: "utf8" }
      );

      assert.equal(
        apply.status,
        0,
        apply.stderr || apply.stdout || "psql apply failed"
      );
    } finally {
      spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    }
  }
);
