#!/usr/bin/env node
/**
 * Apply installation report customer delivery migrations on Test only (axhkdwgmwhlbsstumndh).
 * Requires DATABASE_URL containing the Test project ref. Never logs secrets.
 *
 *   DATABASE_URL='postgresql://postgres.<ref>:…' node scripts/apply-installation-report-test-migrations.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  INSTALLATION_TEST_REF,
  loadInstallationTestEnv,
  resolveInstallationDatabaseUrl,
} from "./lib/installation-phase1-test-env.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS = [
  "20270110175000_installation_report_customer_delivery.sql",
  "20270110176000_installation_reports_notification_preference.sql",
];

function migrationPath(name) {
  return new URL(`../supabase/migrations/${name}`, import.meta.url);
}

async function probe(client) {
  const checks = [];
  const { rows: fnRows } = await client.query(
    `SELECT p.proname
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY($1::text[])`,
    [["installation_publish_completion_report", "installation_unpublish_completion_report"]]
  );
  checks.push({
    name: "publish/unpublish RPCs in pg_catalog",
    ok: fnRows.length === 2,
    detail: fnRows.map((r) => r.proname).join(", ") || "missing",
  });

  const { rows: tableRows } = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [
      [
        "installation_visit_published_reports",
        "installation_completion_report_publication_events",
        "installation_completion_report_deliveries",
      ],
    ]
  );
  checks.push({
    name: "delivery tables",
    ok: tableRows.length === 3,
    detail: `${tableRows.length}/3`,
  });

  const { rows: colRows } = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'contact_notification_preferences'
       AND column_name = 'installation_reports'`
  );
  checks.push({
    name: "installation_reports preference column",
    ok: colRows.length === 1,
    detail: colRows.length === 1 ? "present" : "missing",
  });

  return checks;
}

async function main() {
  loadInstallationTestEnv(root);
  const dbUrl = resolveInstallationDatabaseUrl(root);
  if (!dbUrl?.includes(INSTALLATION_TEST_REF)) {
    console.error(
      "ABORT: DATABASE_URL for Test (axhkdwgmwhlbsstumndh) is required in .env.local or the shell."
    );
    process.exit(2);
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  const results = [];
  try {
    const before = await probe(client);
    results.push({ phase: "before", checks: before });

    for (const name of MIGRATIONS) {
      const sql = readFileSync(migrationPath(name), "utf8");
      if (!sql.includes(INSTALLATION_TEST_REF) && !sql.toLowerCase().includes("installation")) {
        throw new Error(`Refusing to run unexpected migration file: ${name}`);
      }
      try {
        await client.query(sql);
        results.push({ migration: name, status: "applied" });
      } catch (error) {
        results.push({
          migration: name,
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    await client.query(`NOTIFY pgrst, 'reload schema';`);
    results.push({ notify: "pgrst reload schema" });

    const after = await probe(client);
    results.push({ phase: "after", checks: after });
  } finally {
    await client.end();
  }

  const failed = results
    .flatMap((r) => r.checks ?? [])
    .filter((c) => c.ok === false);
  console.log(JSON.stringify({ results, allChecksPass: failed.length === 0 }, null, 2));
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
