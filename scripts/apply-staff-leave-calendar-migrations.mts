import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Applies Stage 3 calendar migrations on Candid OS Test only.
 *
 * DATABASE_URL='postgresql://postgres.[ref]:[password]@...' npx tsx scripts/apply-staff-leave-calendar-migrations.mts
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const TEST_REF = "axhkdwgmwhlbsstumndh";

const MIGRATIONS = [
  "20270110158000_staff_leave_google_calendar.sql",
  "20270110159000_staff_leave_calendar_sync_worker.sql",
] as const;

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

const pg = await import("pg");
const client = new pg.default.Client({ connectionString: url });

await client.connect();

try {
  for (const file of MIGRATIONS) {
    const sql = readFileSync(`${root}/supabase/migrations/${file}`, "utf8");
    console.log(`Applying ${file}...`);
    await client.query(sql);
    console.log(`  OK ${file}`);
  }

  const verify = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'staff_leave_calendar_sync_outbox'
      ) AS outbox_ok,
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'staff_leave_calendar_event_mappings'
      ) AS mappings_ok,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'staff_leave_calendar_enqueue_request_trigger'
      ) AS leave_trigger_ok,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'staff_leave_calendar_enqueue_sickness_trigger'
      ) AS sickness_trigger_ok,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'staff_leave_notification_enqueue_trigger'
      ) AS email_trigger_ok,
      EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'staff_leave_calendar_claim_outbox_batch'
      ) AS claim_rpc_ok
  `);

  const row = verify.rows[0] as Record<string, boolean>;
  console.log("Verification:", row);

  const grants = await client.query(`
    SELECT
      has_function_privilege('authenticated', 'public.staff_leave_calendar_claim_outbox_batch(integer, timestamptz)', 'EXECUTE') AS auth_exec,
      has_function_privilege('service_role', 'public.staff_leave_calendar_claim_outbox_batch(integer, timestamptz)', 'EXECUTE') AS service_exec
  `);
  console.log("Claim RPC execute:", grants.rows[0]);

  const sicknessGrant = await client.query(`
    SELECT
      has_table_privilege('authenticated', 'public.staff_absence_sickness', 'SELECT') AS auth_sickness_select,
      has_table_privilege('service_role', 'public.staff_absence_sickness', 'SELECT') AS service_sickness_select
  `);
  console.log("Sickness SELECT:", sicknessGrant.rows[0]);
} finally {
  await client.end();
}
