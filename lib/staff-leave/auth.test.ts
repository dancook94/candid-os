import assert from "node:assert/strict";
import test from "node:test";

import {
  canDecideLeaveRequests,
  canRecordSickness,
  canSubmitLeaveRequests,
} from "@/lib/staff-leave/auth";

test("approved staff roles can submit leave", () => {
  assert.equal(
    canSubmitLeaveRequests({ id: "1", user_role: "production", account_status: "approved" }),
    true
  );
  assert.equal(
    canSubmitLeaveRequests({ id: "1", user_role: "customer", account_status: "approved" }),
    false
  );
  assert.equal(
    canSubmitLeaveRequests({ id: "1", user_role: "sales", account_status: "pending" }),
    false
  );
});

test("only approved admins can approve or record sickness", () => {
  assert.equal(
    canDecideLeaveRequests({ id: "1", user_role: "admin", account_status: "approved" }),
    true
  );
  assert.equal(
    canDecideLeaveRequests({ id: "1", user_role: "super_admin", account_status: "approved" }),
    true
  );
  assert.equal(
    canDecideLeaveRequests({ id: "1", user_role: "sales", account_status: "approved" }),
    false
  );
  assert.equal(
    canRecordSickness({ id: "1", user_role: "admin", account_status: "approved" }),
    true
  );
  assert.equal(
    canRecordSickness({ id: "1", user_role: "production", account_status: "approved" }),
    false
  );
});
