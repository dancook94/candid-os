import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STAFF_LEAVE_OUTBOX_MAX_ATTEMPTS,
  STAFF_LEAVE_OUTBOX_STALE_LOCK_MS,
} from "@/lib/staff-leave/notifications/outbox-constants";
import {
  buildStaffLeaveOutboxClaimFilter,
  isStaleStaffLeaveOutboxLock,
  staleStaffLeaveOutboxLockCutoff,
} from "@/lib/staff-leave/notifications/process-outbox";

const GRANTS_MIGRATION = new URL(
  "../../../supabase/migrations/20270110156000_staff_leave_notification_service_role_grants.sql",
  import.meta.url
);

test("service_role grants migration is scoped and does not widen anon/authenticated", async () => {
  const sql = await readFile(GRANTS_MIGRATION, "utf8");

  assert.match(sql, /GRANT SELECT ON TABLE public\.staff_leave_requests TO service_role/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.notification_settings TO service_role/);
  assert.doesNotMatch(sql, /TO authenticated/);
  assert.doesNotMatch(sql, /TO anon/);
  assert.match(sql, /RLS remains enabled/i);
});

test("stale lock detection reclaims abandoned processing rows", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");
  const fresh = "2026-01-01T11:56:00.000Z";
  const stale = "2026-01-01T11:54:59.000Z";

  assert.equal(isStaleStaffLeaveOutboxLock(null, now), true);
  assert.equal(isStaleStaffLeaveOutboxLock(fresh, now), false);
  assert.equal(isStaleStaffLeaveOutboxLock(stale, now), true);
});

test("claim filter includes pending, failed, and stale processing", () => {
  const cutoff = staleStaffLeaveOutboxLockCutoff(Date.parse("2026-01-01T12:00:00.000Z"));
  const filter = buildStaffLeaveOutboxClaimFilter(cutoff);

  assert.match(filter, /status\.in\.\(pending,failed\)/);
  assert.match(filter, /status\.eq\.processing/);
  assert.match(filter, /locked_at\.lt\./);
  assert.match(filter, /locked_at\.is\.null/);
});

test("processor handles errors without leaving silent processing state", async () => {
  const source = await readFile(
    new URL("./process-outbox.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /catch \(error\)/);
  assert.match(source, /markOutboxFailed/);
  assert.match(source, /staff_leave_requests_select_denied/);
  assert.match(source, /notificationAlreadyDelivered/);
  assert.match(source, /sendResult\.duplicate/);
  assert.match(source, /STAFF_LEAVE_OUTBOX_MAX_ATTEMPTS/);
  assert.match(source, /input\?\.outboxId/);
});

test("scoped outboxId processing limits to a single row", async () => {
  const source = await readFile(
    new URL("./process-outbox.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /\.eq\("id", input\.outboxId\)/);
  assert.match(source, /input\?\.outboxId != null[\s\S]*\? 1/);
});

test("retry limit constant remains five attempts", () => {
  assert.equal(STAFF_LEAVE_OUTBOX_MAX_ATTEMPTS, 5);
  assert.equal(STAFF_LEAVE_OUTBOX_STALE_LOCK_MS, 5 * 60 * 1000);
});
