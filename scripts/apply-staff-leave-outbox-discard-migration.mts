import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Applies 20270110157000_staff_leave_notification_outbox_discard.sql on Candid OS Test.
 *
 *   DATABASE_URL='postgresql://postgres.[ref]:[password]@...' npx tsx scripts/apply-staff-leave-outbox-discard-migration.mts
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const TEST_REF = "axhkdwgmwhlbsstumndh";

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
  console.error("DATABASE_URL is required (env or .env.local).");
  process.exit(1);
}

if (!url.includes(TEST_REF)) {
  console.error("Refusing: DATABASE_URL is not Candid OS Test.");
  process.exit(1);
}

const sql = readFileSync(
  `${root}/supabase/migrations/20270110157000_staff_leave_notification_outbox_discard.sql`,
  "utf8"
);

const pg = await import("pg");
const client = new pg.default.Client({ connectionString: url });

await client.connect();
try {
  await client.query(sql);
  const verify = await client.query<{ ok: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'staff_leave_notification_outbox'
        AND column_name = 'discarded_at'
    ) AS ok
  `);
  console.log(
    verify.rows[0]?.ok
      ? "Migration 20270110157000 applied (discarded_at present)."
      : "Migration ran but discarded_at not found."
  );
} finally {
  await client.end();
}
