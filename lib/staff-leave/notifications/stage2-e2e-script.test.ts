import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SCRIPT = new URL(
  "../../../scripts/verify-stage2-leave-notifications-e2e.mjs",
  import.meta.url
);

test("Stage 2 E2E script covers six notification scenarios on Test only", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.match(source, /axhkdwgmwhlbsstumndh/);
  assert.match(source, /candid-os-test\.vercel\.app/);
  assert.match(source, /staff-leave-notifications\/controlled/);
  assert.match(source, /management_annual_submitted/);
  assert.match(source, /management_additional_paid_submitted/);
  assert.match(source, /employee_approved/);
  assert.match(source, /employee_declined/);
  assert.match(source, /management_approved_cancelled/);
  assert.match(source, /employee_additional_paid_granted/);
  assert.match(source, /cron may still process other rows concurrently/i);
  assert.match(source, /20270110157000/);
  assert.doesNotMatch(source, /from\("notifications"\)\.delete/i);
});
