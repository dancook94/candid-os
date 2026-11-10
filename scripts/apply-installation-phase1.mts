import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Applies Installation Management Phase 1 on Candid OS Test only.
 *
 * DATABASE_URL='postgresql://postgres.[ref]:[password]@...' \\
 *   npx tsx scripts/apply-installation-phase1.mts
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const TEST_REF = "axhkdwgmwhlbsstumndh";
const MIGRATION = "20270110163000_installation_management_phase1.sql";

function databaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const envPath = `${root}/.env.local`;
  if (!existsSync(envPath)) {
    return null;
  }

  const env = readFileSync(envPath, "utf8");
  const match = env.match(/^DATABASE_URL=(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

const url = databaseUrl();
if (!url) {
  console.error("DATABASE_URL is required (environment or .env.local).");
  console.error(
    "Alternatively apply supabase/migrations/20270110163000_installation_management_phase1.sql in the Supabase SQL Editor for project",
    TEST_REF,
  );
  process.exit(1);
}

if (!url.includes(TEST_REF)) {
  console.error(`Refusing: DATABASE_URL must reference Test project ${TEST_REF}.`);
  process.exit(1);
}

const sql = readFileSync(`${root}/supabase/migrations/${MIGRATION}`, "utf8");

const pg = await import("pg");
const client = new pg.default.Client({ connectionString: url });

console.log(`Target: ${TEST_REF}`);
console.log(`Applying ${MIGRATION}...`);

await client.connect();

try {
  await client.query(sql);
  const verify = await client.query(`
    SELECT count(*)::int AS installation_tables
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE 'installation_%'
  `);
  console.log("OK", MIGRATION, "installation_tables=", verify.rows[0]?.installation_tables);
} finally {
  await client.end();
}
