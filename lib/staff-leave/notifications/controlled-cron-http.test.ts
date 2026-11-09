import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CONTROLLED_ROUTE = new URL(
  "../../../app/api/cron/staff-leave-notifications/controlled/route.ts",
  import.meta.url
);
const CONTROLLED_HTTP = new URL("./controlled-cron-http.ts", import.meta.url);
const DISCARD_MIGRATION = new URL(
  "../../../supabase/migrations/20270110157000_staff_leave_notification_outbox_discard.sql",
  import.meta.url
);

test("controlled cron route delegates to Test-only handler", async () => {
  const route = await readFile(CONTROLLED_ROUTE, "utf8");
  assert.match(route, /handleStaffLeaveControlledNotificationsCron/);
});

test("controlled cron handler is gated to Test app env", async () => {
  const source = await readFile(CONTROLLED_HTTP, "utf8");
  assert.match(source, /isTestAppEnvironment/);
  assert.match(source, /outboxId/);
  assert.doesNotMatch(source, /requestId/);
  assert.match(source, /cronAuthorizationMatches/);
  assert.match(source, /staffLeaveControlledE2eAuthorized/);
  assert.match(source, /processStaffLeaveNotificationOutbox/);
  assert.match(source, /limit:\s*1,/);
  assert.match(source, /scheduled cron/i);
  assert.doesNotMatch(source, /STAFF_LEAVE_OUTBOX_DEFAULT_BATCH_LIMIT/);
});

test("discard migration adds discarded status without removing audit history", async () => {
  const sql = await readFile(DISCARD_MIGRATION, "utf8");
  assert.match(sql, /discarded/);
  assert.match(sql, /discard_reason/);
  assert.match(sql, /discarded_at/);
  assert.doesNotMatch(sql, /DELETE FROM public\.notifications/i);
});
