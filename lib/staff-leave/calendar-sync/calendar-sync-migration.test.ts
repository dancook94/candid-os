import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../../supabase/migrations/20270110158000_staff_leave_google_calendar.sql",
  import.meta.url
);

test("calendar migration defines outbox, mappings, and parallel enqueue triggers", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /staff_leave_calendar_sync_outbox/);
  assert.match(sql, /staff_leave_calendar_event_mappings/);
  assert.match(sql, /staff_leave_calendar_enqueue_from_request_event/);
  assert.match(sql, /staff_leave_calendar_enqueue_from_sickness/);
  assert.match(sql, /staff_leave_calendar_enqueue_request_trigger/);
  assert.match(sql, /staff_leave_calendar_enqueue_sickness_trigger/);
  assert.match(sql, /leave_approved/);
  assert.match(sql, /leave_cancelled_approved/);
  assert.match(sql, /sickness_recorded/);
  assert.match(sql, /sync_provider/);
  assert.match(sql, /CHECK \(sync_provider IS NULL OR sync_provider IN \('mock', 'google'\)\)/);
  assert.match(sql, /ON CONFLICT \(source_event_id\) DO NOTHING/);
  assert.match(sql, /ON CONFLICT \(sickness_id\) WHERE source_kind = 'sickness_recorded' DO NOTHING/);
  assert.doesNotMatch(sql, /staff_leave_notification_enqueue/);
  assert.doesNotMatch(sql, /staff_absence_sickness\.reason/);
  assert.doesNotMatch(sql, /private_note/);
});

test("calendar migration does not widen client table access", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /REVOKE ALL ON TABLE public\.staff_leave_calendar_sync_outbox FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.staff_leave_calendar_sync_outbox TO service_role/);
  assert.doesNotMatch(sql, /GRANT .* TO authenticated/);
});
