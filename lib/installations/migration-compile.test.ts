import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110163000_installation_management_phase1.sql",
  import.meta.url
);
const STUBS = new URL("./migration-compile.stubs.sql", import.meta.url);
const HARDENING = new URL(
  "../../supabase/migrations/20270110164000_installation_phase1_hardening.sql",
  import.meta.url
);
const HARDENING_REPAIR = new URL(
  "../../supabase/migrations/20270110165000_installation_phase1_hardening_repair.sql",
  import.meta.url
);

const PHASE2 = new URL(
  "../../supabase/migrations/20270110168000_installation_phase2_acceptance.sql",
  import.meta.url
);

const SQL_EDITOR_MIGRATIONS = [MIGRATION, HARDENING, HARDENING_REPAIR, PHASE2];

function assertSqlEditorCompatible(sql: string, label: string) {
  assert.doesNotMatch(sql, /\\set\s/i);
  assert.doesNotMatch(sql, /ON_ERROR_STOP/i);
  assert.doesNotMatch(sql, /^\\[a-z]/im);

  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("--")) {
      continue;
    }
    assert.doesNotMatch(
      trimmed,
      /^\\[a-z]/i,
      `${label}: psql meta-command on line: ${trimmed.slice(0, 80)}`
    );
  }

  assert.match(sql, /^BEGIN;\s*$/m);
  assert.match(sql, /^COMMIT;\s*$/m);
}

test("installation migrations are Supabase SQL Editor compatible", async () => {
  for (const file of SQL_EDITOR_MIGRATIONS) {
    const sql = await readFile(file, "utf8");
    assertSqlEditorCompatible(sql, file.pathname);
  }
});

test("installation detection SQL distinguishes delivery-only lines", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /installation_is_delivery_only_line/);
  assert.match(sql, /installation_quote_line_qualifies/);
});

test("multiple visits per project are supported", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /installation_visit_create_admin/);
  assert.match(sql, /max\(visit_number\)/);
});

test("accounts role is excluded from installation readers", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const reader = sql.match(
    /CREATE OR REPLACE FUNCTION public\.is_approved_installation_reader\([\s\S]*?\$\$;/
  )?.[0];

  assert.ok(reader);
  assert.match(reader, /'production'/);
  assert.match(reader, /'sales'/);
  assert.doesNotMatch(reader, /'accounts'/);
});

function dockerAvailable() {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  return result.status === 0;
}

test(
  "installation phase 1 migration compiles on disposable Postgres",
  { skip: !dockerAvailable() },
  async () => {
    const containerName = `installation-migration-${process.pid}`;
    const migrationSql = await readFile(MIGRATION, "utf8");
    const hardeningSql = await readFile(HARDENING, "utf8");
    const stubsSql = await readFile(STUBS, "utf8");
    const combined = `${stubsSql}\n${migrationSql}\n${hardeningSql}`;

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

        execFileSync("sleep", ["1"]);
      }

      execFileSync(
        "docker",
        [
          "exec",
          "-i",
          containerName,
          "psql",
          "-U",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        { input: combined, stdio: ["pipe", "pipe", "pipe"] }
      );
    } finally {
      spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    }
  }
);
