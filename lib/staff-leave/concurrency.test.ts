import assert from "node:assert/strict";
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
