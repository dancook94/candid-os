import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Applies supabase/migrations/20261110120000_consolidate_hips_duplicate.sql on Test.
 * Requires DATABASE_URL (direct Postgres) in the environment or .env.local.
 *
 *   DATABASE_URL='postgresql://...' npx tsx scripts/apply-consolidate-hips-migration.mts
 */

const root = fileURLToPath(new URL("..", import.meta.url));

function databaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
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
  console.error(
    "DATABASE_URL is required to apply the import-function portion of the migration."
  );
  process.exit(1);
}

if (!url.includes("axhkdwgmwhlbsstumndh")) {
  console.error("Refusing to apply: DATABASE_URL does not look like Candid OS Test.");
  process.exit(1);
}

const pg = await import("pg");
const sql = readFileSync(
  `${root}/supabase/migrations/20261110120000_consolidate_hips_duplicate.sql`,
  "utf8"
);

const client = new pg.default.Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  console.log("Migration applied.");
} finally {
  await client.end();
}
