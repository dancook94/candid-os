import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const BASE_MIGRATION = new URL(
  "../../../supabase/migrations/20270110158000_staff_leave_google_calendar.sql",
  import.meta.url
);

const WORKER_MIGRATION = new URL(
  "../../../supabase/migrations/20270110159000_staff_leave_calendar_sync_worker.sql",
  import.meta.url
);

test("calendar migrations do not grant authenticated access to outbox or sickness", async () => {
  const base = await readFile(BASE_MIGRATION, "utf8");
  const worker = await readFile(WORKER_MIGRATION, "utf8");

  assert.match(base, /REVOKE ALL ON TABLE public\.staff_leave_calendar_sync_outbox FROM PUBLIC, anon, authenticated/);
  assert.match(base, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.staff_leave_calendar_sync_outbox TO service_role/);
  assert.match(base, /GRANT SELECT ON TABLE public\.staff_absence_sickness TO service_role/);
  assert.doesNotMatch(base, /GRANT SELECT ON TABLE public\.staff_absence_sickness TO authenticated/);
  assert.doesNotMatch(base, /GRANT .* TO authenticated/);
  assert.doesNotMatch(worker, /GRANT .* TO authenticated/);
});

test("enqueue triggers remain SECURITY DEFINER with search_path", async () => {
  const base = await readFile(BASE_MIGRATION, "utf8");

  assert.match(base, /staff_leave_calendar_enqueue_from_request_event[\s\S]*SECURITY DEFINER/);
  assert.match(base, /staff_leave_calendar_enqueue_from_sickness[\s\S]*SECURITY DEFINER/);
  assert.match(base, /SET search_path = public/);
});

test("admin calendar status route checks admin leave permissions", async () => {
  const statusRoute = await readFile(
    new URL("../../../app/api/admin/leave/calendar-sync/status/route.ts", import.meta.url),
    "utf8"
  );
  const reconcileRoute = await readFile(
    new URL("../../../app/api/admin/leave/calendar-sync/reconcile/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(statusRoute, /canDecideLeaveRequests/);
  assert.match(statusRoute, /createAdminClient/);
  assert.match(reconcileRoute, /canDecideLeaveRequests/);
  assert.doesNotMatch(statusRoute, /staff_absence_sickness/);
});
