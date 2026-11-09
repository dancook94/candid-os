import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("calendar controlled cron route is Test-only and scoped by outboxId", async () => {
  const handler = await readFile(
    new URL("./controlled-cron-http.ts", import.meta.url),
    "utf8"
  );
  const route = await readFile(
    new URL(
      "../../../app/api/cron/staff-leave-calendar-sync/controlled/route.ts",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(handler, /isTestAppEnvironment\(\)/);
  assert.match(handler, /outboxId/);
  assert.match(handler, /processStaffLeaveCalendarSyncOutbox/);
  assert.match(handler, /staffLeaveCalendarControlledE2eAuthorized/);
  assert.match(route, /handleStaffLeaveControlledCalendarSyncCron/);
});

test("scheduled calendar cron uses shared cron auth", async () => {
  const source = await readFile(new URL("./cron-http.ts", import.meta.url), "utf8");

  assert.match(source, /cronAuthorizationMatches/);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /processStaffLeaveCalendarSyncOutbox/);
  assert.match(source, /STAFF_LEAVE_GCAL_CRON_PAUSED/);
  assert.match(source, /calendar_cron_paused/);
});
