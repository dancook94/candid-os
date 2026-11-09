import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("controlled reconcile cron is Test-only and uses calendar controlled e2e auth", async () => {
  const handler = await readFile(
    new URL("./controlled-reconcile-cron-http.ts", import.meta.url),
    "utf8"
  );
  const route = await readFile(
    new URL(
      "../../../app/api/cron/staff-leave-calendar-sync/reconcile-controlled/route.ts",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(handler, /isTestAppEnvironment\(\)/);
  assert.match(handler, /scanStaffLeaveCalendarReconciliation/);
  assert.match(handler, /enqueueStaffLeaveCalendarReconciliation/);
  assert.match(handler, /staffLeaveCalendarControlledE2eAuthorized/);
  assert.match(route, /handleStaffLeaveControlledCalendarReconcileCron/);
});
