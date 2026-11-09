import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CALENDAR_BASE = new URL(
  "../../../supabase/migrations/20270110158000_staff_leave_google_calendar.sql",
  import.meta.url
);
const ON_CONFLICT_FIX = new URL(
  "../../../supabase/migrations/20270110160000_staff_leave_calendar_on_conflict_fix.sql",
  import.meta.url
);
const WORKER_MIGRATION = new URL(
  "../../../supabase/migrations/20270110159000_staff_leave_calendar_sync_worker.sql",
  import.meta.url
);
const SICKNESS_FIX = new URL(
  "../../../supabase/migrations/20270110161000_staff_leave_calendar_sickness_on_conflict_fix.sql",
  import.meta.url
);

test("calendar leave enqueue ON CONFLICT matches partial source_event_id index", async () => {
  const worker = await readFile(WORKER_MIGRATION, "utf8");
  const fix = await readFile(ON_CONFLICT_FIX, "utf8");

  assert.match(
    worker,
    /staff_leave_calendar_sync_outbox_source_event_id_key[\s\S]*WHERE source_event_id IS NOT NULL/
  );
  assert.match(
    fix,
    /ON CONFLICT \(source_event_id\) WHERE source_event_id IS NOT NULL DO NOTHING/
  );
});

test("calendar sickness enqueue ON CONFLICT matches partial sickness index (161000)", async () => {
  const base = await readFile(CALENDAR_BASE, "utf8");
  const fix = await readFile(SICKNESS_FIX, "utf8");

  assert.match(
    base,
    /staff_leave_calendar_sync_outbox_sickness_upsert_idx[\s\S]*source_kind = 'sickness_recorded' AND sickness_id IS NOT NULL/
  );
  assert.match(
    fix,
    /ON CONFLICT \(sickness_id\) WHERE source_kind = 'sickness_recorded' AND sickness_id IS NOT NULL/
  );
});
