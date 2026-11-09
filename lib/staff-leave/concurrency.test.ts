import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Models the SQL guard `UPDATE ... WHERE status = 'pending'`.
 * Only one concurrent approver succeeds; subsequent calls see no pending row.
 */
function decidePendingRequest(
  store: { id: string; status: "pending" | "approved" | "rejected" },
  decision: "approved" | "rejected"
) {
  if (store.status !== "pending") {
    return { ok: false as const, reason: "already_decided" as const };
  }

  store.status = decision;
  return { ok: true as const, status: store.status };
}

test("profile-scoped operations serialize via transactional advisory lock contract", async () => {
  const sql = await readFile(
    new URL(
      "../../supabase/migrations/20270110150000_staff_leave_patterns_additional_paid.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /pg_advisory_xact_lock\(hashtext\(p_profile_id::text\)\)/);
  assert.match(sql, /submit_staff_leave_request[\s\S]*staff_leave_lock_profile\(actor\)/);
  assert.match(sql, /grant_staff_additional_paid_leave[\s\S]*staff_leave_lock_profile\(p_profile_id\)/);
  assert.match(sql, /decide_staff_leave_request[\s\S]*FOR UPDATE/);
});

test("duplicate concurrent approvals only apply once", () => {
  const request = { id: "req-1", status: "pending" as const };

  const first = decidePendingRequest(request, "approved");
  const second = decidePendingRequest(request, "rejected");

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.reason, "already_decided");
  }
  assert.equal(request.status, "approved");
});
