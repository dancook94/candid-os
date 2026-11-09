#!/usr/bin/env npx tsx
/**
 * Read-only pg_catalog verification for Stage 3 calendar migrations (Test only).
 * Requires DATABASE_URL containing project ref axhkdwgmwhlbsstumndh.
 */
const TEST_REF = "axhkdwgmwhlbsstumndh";
const url = process.env.DATABASE_URL?.trim() ?? "";

if (!url.includes(TEST_REF)) {
  console.error(`Refusing: DATABASE_URL must reference ${TEST_REF}`);
  process.exit(2);
}

const pg = await import("pg");
const client = new pg.default.Client({ connectionString: url });

await client.connect();

try {
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
        WHERE tgname = 'staff_leave_calendar_sync_outbox_discard_guard_trigger'
      ) AS discard_guard_ok,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'staff_leave_notification_enqueue_trigger'
      ) AS email_trigger_ok,
      EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'staff_leave_calendar_claim_outbox_batch'
      ) AS claim_rpc_ok,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'staff_leave_calendar_sync_outbox_reconcile_leave_pending_idx'
      ) AS reconcile_leave_idx_ok,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'staff_leave_calendar_sync_outbox_reconcile_sickness_pending_idx'
      ) AS reconcile_sickness_idx_ok
  `);

  const grants = await client.query(`
    SELECT
      has_function_privilege('authenticated', 'public.staff_leave_calendar_claim_outbox_batch(integer, timestamptz)', 'EXECUTE') AS auth_exec,
      has_function_privilege('service_role', 'public.staff_leave_calendar_claim_outbox_batch(integer, timestamptz)', 'EXECUTE') AS service_exec,
      has_table_privilege('authenticated', 'public.staff_leave_calendar_sync_outbox', 'SELECT') AS auth_outbox_select,
      has_table_privilege('service_role', 'public.staff_leave_calendar_sync_outbox', 'SELECT') AS service_outbox_select
  `);

  const rls = await client.query(`
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'staff_leave_calendar_sync_outbox',
        'staff_leave_calendar_event_mappings'
      )
    ORDER BY c.relname
  `);

  const row = verify.rows[0] as Record<string, boolean>;
  const allOk = Object.values(row).every(Boolean);
  const grantRow = grants.rows[0] as Record<string, boolean>;
  const rlsOk = rls.rows.every((r: { relrowsecurity: boolean }) => r.relrowsecurity === true);

  console.log(JSON.stringify({ catalog: row, grants: grantRow, rls: rls.rows, allOk, rlsOk }, null, 2));

  process.exitCode = allOk && rlsOk && !grantRow.auth_exec && grantRow.service_exec ? 0 : 1;
} finally {
  await client.end();
}
