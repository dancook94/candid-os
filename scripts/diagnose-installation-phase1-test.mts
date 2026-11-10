#!/usr/bin/env npx tsx
/**
 * Installation Phase 1 read-only diagnostic (Test: axhkdwgmwhlbsstumndh).
 *
 * With DATABASE_URL: runs scripts/diagnose-installation-phase1-test.sql via pg.
 * Without: PostgREST + service-role probes only (cannot confirm pg_proc).
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "axhkdwgmwhlbsstumndh";
const root = fileURLToPath(new URL("..", import.meta.url));

function loadEnvFile() {
  const path = `${root}/.env.local`;
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function databaseUrl() {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv?.includes(TEST_REF)) return fromEnv;
  const path = `${root}/.env.local`;
  if (!existsSync(path)) return null;
  const match = readFileSync(path, "utf8").match(/^DATABASE_URL=(.+)$/m);
  const value = match?.[1]?.trim();
  return value?.includes(TEST_REF) ? value : null;
}

loadEnvFile();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

const report: Record<string, unknown> = {
  testRef: TEST_REF,
  timestamp: new Date().toISOString(),
};

if (!supabaseUrl.includes(TEST_REF)) {
  console.error(`Refusing: Supabase URL must include ${TEST_REF}`);
  process.exit(2);
}

const TABLES = [
  "installation_projects",
  "installation_visits",
  "installation_visit_assignments",
  "installation_visit_documents",
  "installation_visit_photos",
  "installation_snag_items",
  "installation_sign_offs",
  "installation_visit_events",
];

const postgrest: Record<string, string> = {};
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

for (const table of TABLES) {
  const { error } = await admin.from(table).select("id").limit(1);
  if (!error) {
    postgrest[table] = "OK";
    continue;
  }

  if (error.code === "PGRST205") {
    postgrest[table] = "MISSING";
    continue;
  }

  if (error.code === "42501") {
    postgrest[table] = "EXISTS_DENIED_SERVICE_ROLE";
    continue;
  }

  postgrest[table] = `ERR ${error.code}: ${error.message}`;
}

const { error: rpcError } = await admin.rpc("installation_reconcile_for_job", {
  p_job_id: "00000000-0000-4000-8000-000000000099",
});

postgrest.installation_reconcile_for_job = rpcError
  ? `ERR ${rpcError.code ?? "?"}: ${rpcError.message}`
  : "OK";

report.postgrest = postgrest;

const pgUrl = databaseUrl();
if (pgUrl) {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: pgUrl });
  await client.connect();

  try {
    const tableCount = await client.query(`
      SELECT count(*)::int AS n
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `, [TABLES]);

    const reconcileRpc = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'installation_reconcile_for_job'
      ) AS in_database
    `);

    const appendPriv = await client.query(`
      SELECT has_function_privilege(
        'authenticated',
        'public.installation_append_visit_event(uuid,text,jsonb)',
        'EXECUTE'
      ) AS auth_can_execute_append
    `);

    const rpcList = await client.query(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'installation_%'
      ORDER BY 1, 2
    `);

    const rls = await client.query(`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname LIKE 'installation_%' AND c.relkind = 'r'
      ORDER BY 1
    `);

    const bucket = await client.query(`
      SELECT id, name, public FROM storage.buckets WHERE id = 'installation-files'
    `);

    const storagePolicies = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname LIKE 'installation_%'
      ORDER BY 1
    `);

    let migrationHistory: unknown[] = [];
    try {
      const hist = await client.query(`
        SELECT version, name
        FROM supabase_migrations.schema_migrations
        WHERE name ILIKE '%installation%' OR version::text LIKE '%20270110163%'
        ORDER BY version
      `);
      migrationHistory = hist.rows;
    } catch {
      migrationHistory = ["supabase_migrations.schema_migrations unavailable"];
    }

    report.pgCatalog = {
      tablesFound: tableCount.rows[0]?.n,
      reconcileRpcInDatabase: reconcileRpc.rows[0]?.in_database,
      appendEventAuthExecute: appendPriv.rows[0]?.auth_can_execute_append,
      rpcCount: rpcList.rows.length,
      rpcNames: rpcList.rows,
      rls,
      bucket: bucket.rows[0] ?? null,
      storagePolicies: storagePolicies.rows.map((r) => r.policyname),
      migrationHistory,
    };

    const tablesOk = tableCount.rows[0]?.n === 8;
    const rpcInDb = reconcileRpc.rows[0]?.in_database === true;
    const pgrstRpcMissing = String(postgrest.installation_reconcile_for_job).includes(
      "PGRST202"
    );

    const postgrestTablesOk = TABLES.every(
      (table) =>
        postgrest[table] === "OK" ||
        postgrest[table] === "EXISTS_DENIED_SERVICE_ROLE"
    );

    report.diagnosis =
      tablesOk && rpcInDb && pgrstRpcMissing
        ? "Functions exist in Postgres but PostgREST schema cache is likely stale (run NOTIFY pgrst, 'reload schema';)."
        : tablesOk && !rpcInDb
          ? "Tables present without installation_reconcile_for_job — migration 163000 likely partial or tables created out-of-band. Do not re-run 163000 blindly; compare pg_proc list to expected RPCs."
          : tablesOk && rpcInDb && !pgrstRpcMissing
            ? "Migration appears applied and PostgREST exposes reconcile RPC."
            : !tablesOk && !postgrestTablesOk
              ? "Migration 163000 not applied (PostgREST and pg_catalog agree)."
              : !postgrestTablesOk
                ? "PostgREST reports missing installation tables — migration not applied or schema cache stale."
                : "Unexpected state — review full report.";
  } finally {
    await client.end();
  }
} else {
  report.pgCatalog = "skipped (DATABASE_URL not set for Test)";
  report.diagnosis =
    String(postgrest.installation_reconcile_for_job).includes("PGRST202") &&
    Object.values(postgrest).filter((v) => v === "OK").length >= 8
      ? "All eight tables visible to PostgREST but reconcile RPC missing from API — likely stale cache OR functions not created. Set DATABASE_URL and re-run this script."
      : "PostgREST probe only — set DATABASE_URL for pg_catalog checks.";
}

console.log(JSON.stringify(report, null, 2));
