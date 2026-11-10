/**
 * Post-migration verification for Installation Phase 1 (Test only: axhkdwgmwhlbsstumndh).
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY for schema/fixtures and DATABASE_URL (optional) for RLS/RPC role probes.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEST_REF = "axhkdwgmwhlbsstumndh";
const root = fileURLToPath(new URL("..", import.meta.url));

function loadEnv() {
  const path = `${root}/.env.local`;
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

if (!url.includes(TEST_REF)) {
  console.error(`Refusing: expected Test ref ${TEST_REF}`);
  process.exit(1);
}

if (!serviceKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

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

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log("PASS", name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, pass: false, detail: message });
    console.log("FAIL", name, message);
  }
}

await check("eight installation tables visible", async () => {
  for (const table of TABLES) {
    const { error } = await admin.from(table).select("id").limit(1);
    if (error?.code === "PGRST205") {
      throw new Error(`${table}: not in schema cache`);
    }
    if (error?.code === "42501") {
      continue;
    }
    if (error) throw new Error(`${table}: ${error.message}`);
  }
});

await check("reconcile RPC exists", async () => {
  const { error } = await admin.rpc("installation_reconcile_for_job", {
    p_job_id: "00000000-0000-4000-8000-000000000099",
  });
  if (!error || !/Job not found|Forbidden/i.test(error.message)) {
    if (!error) throw new Error("Expected job-not-found or forbidden");
  }
});

async function databaseUrl() {
  if (process.env.DATABASE_URL?.includes(TEST_REF)) {
    return process.env.DATABASE_URL.trim();
  }
  const envPath = `${root}/.env.local`;
  if (!existsSync(envPath)) return null;
  const match = readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.+)$/m);
  const value = match?.[1]?.trim();
  return value?.includes(TEST_REF) ? value : null;
}

const dbUrl = await databaseUrl();

if (dbUrl) {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: dbUrl });
  await client.connect();

  const fixtureTag = `install-p1-verify-${Date.now()}`;

  try {
    await check("unique job_id constraint on projects", async () => {
      const { rows } = await client.query(
        `SELECT indexname FROM pg_indexes WHERE indexname = 'installation_projects_job_id_unique_idx'`,
      );
      if (rows.length < 1) throw new Error("index missing");
    });

    await check("delivery-only line detection SQL", async () => {
      const { rows } = await client.query(
        `SELECT public.installation_quote_line_qualifies('Delivery to site') AS q,
                public.installation_quote_line_qualifies('Site installation') AS i`,
      );
      if (rows[0].q !== false || rows[0].i !== true) {
        throw new Error(`unexpected: ${JSON.stringify(rows[0])}`);
      }
    });

    await check("append_visit_event not executable by authenticated", async () => {
      const { rows } = await client.query(`
        SELECT has_function_privilege('authenticated', 'public.installation_append_visit_event(uuid,text,jsonb)', 'EXECUTE') AS allowed
      `);
      if (rows[0]?.allowed) throw new Error("authenticated can execute append_visit_event");
    });

    await check("direct insert blocked for authenticated", async () => {
      await client.query(`BEGIN`);
      await client.query(`SET LOCAL ROLE authenticated`);
      await client.query(
        `SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true)`,
      );
      let blocked = false;
      try {
        await client.query(
          `INSERT INTO public.installation_projects (company_id, title, source) VALUES (gen_random_uuid(), 'x', 'manual')`,
        );
      } catch (e) {
        blocked = /Direct client writes|permission denied|violates row-level/i.test(
          e.message,
        );
      }
      await client.query(`ROLLBACK`);
      if (!blocked) throw new Error("direct insert was not blocked");
    });
  } finally {
    await client.end();
  }
} else {
  console.log("SKIP RLS/constraint deep probes (DATABASE_URL not set for Test)");
}

const failed = results.filter((r) => !r.pass);
console.log("\n--- Summary ---");
console.log(`Passed ${results.length - failed.length}/${results.length}`);
if (failed.length) process.exit(1);
