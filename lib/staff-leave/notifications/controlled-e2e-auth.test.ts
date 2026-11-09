import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { staffLeaveControlledE2eBearerToken } from "@/lib/staff-leave/notifications/controlled-e2e-auth";

test("E2E bearer is stable and non-empty", () => {
  const a = staffLeaveControlledE2eBearerToken("test-service-role-key");
  const b = staffLeaveControlledE2eBearerToken("test-service-role-key");
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("controlled cron allows Test-only E2E auth helper", async () => {
  const source = await readFile(
    new URL("./controlled-e2e-auth.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /e2eAuth/);
  assert.match(source, /x-staff-leave-e2e/i);
  assert.match(source, /isTestAppEnvironment/);
});
