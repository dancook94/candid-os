import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110120000_staff_leave_phase1.sql",
  import.meta.url
);
const STUBS = new URL("./migration-compile.stubs.sql", import.meta.url);

test("staff_leave_balance does not reuse holiday_year as both input arg and TABLE output", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const balanceBlock = sql.match(
    /CREATE OR REPLACE FUNCTION public\.staff_leave_balance\([\s\S]*?\$\$;/
  )?.[0];

  assert.ok(balanceBlock, "staff_leave_balance definition missing");
  assert.match(balanceBlock, /p_holiday_year integer/);
  assert.match(balanceBlock, /RETURNS TABLE\(\s*holiday_year integer/);
  assert.doesNotMatch(
    balanceBlock,
    /CREATE OR REPLACE FUNCTION public\.staff_leave_balance\(\s*target_profile uuid,\s*holiday_year integer/
  );
});

test("staff_leave_used_days filters by the requested holiday year", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const usedBlock = sql.match(
    /CREATE OR REPLACE FUNCTION public\.staff_leave_used_days\([\s\S]*?\$\$;/
  )?.[0];

  assert.ok(usedBlock, "staff_leave_used_days definition missing");
  assert.match(usedBlock, /p_holiday_year integer/);
  assert.match(usedBlock, /r\.holiday_year = p_holiday_year/);
  assert.doesNotMatch(usedBlock, /holiday_year = holiday_year/);
});

function dockerAvailable() {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  return result.status === 0;
}

test(
  "staff leave phase 1 migration compiles on disposable Postgres",
  { skip: !dockerAvailable() },
  async () => {
    const containerName = `staff-leave-migration-${process.pid}`;
    const migrationSql = await readFile(MIGRATION, "utf8");
    const stubsSql = await readFile(STUBS, "utf8");
    const combined = `${stubsSql}\n${migrationSql}`;

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
        if (ready.status === 0) {
          break;
        }
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
      assert.match(apply.stdout + apply.stderr, /COMMIT/i);
    } finally {
      spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    }
  }
);
