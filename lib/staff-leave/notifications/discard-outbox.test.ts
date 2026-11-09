import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DISCARDABLE_OUTBOX_STATUSES } from "@/lib/staff-leave/notifications/discard-outbox";

test("discard targets only claimable queue statuses", () => {
  assert.deepEqual([...DISCARDABLE_OUTBOX_STATUSES], ["pending", "failed", "processing"]);
});

test("discard outbox updates status without touching notifications table", async () => {
  const source = await readFile(new URL("./discard-outbox.ts", import.meta.url), "utf8");
  assert.match(source, /status:\s*"discarded"/);
  assert.match(source, /discard_reason/);
  assert.match(source, /discard_sent_outbox_forbidden/);
  assert.doesNotMatch(source, /from\("notifications"\)/i);
});

test("discard migration forbids discarding sent outbox rows", async () => {
  const sql = await readFile(
    new URL(
      "../../../supabase/migrations/20270110157000_staff_leave_notification_outbox_discard.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(sql, /staff_leave_notification_outbox_discard_guard/);
  assert.match(sql, /Cannot discard sent staff leave notification outbox rows/);
});
