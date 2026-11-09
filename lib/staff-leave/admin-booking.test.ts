import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const BOOKING_MIGRATION = new URL(
  "../../supabase/migrations/20270110154000_staff_leave_admin_booking.sql",
  import.meta.url
);

test("admin booking migration creates pending on-behalf annual submit", async () => {
  const sql = await readFile(BOOKING_MIGRATION, "utf8");

  assert.match(sql, /submit_staff_leave_request_for_profile/);
  assert.match(sql, /is_approved_candid_admin\(\)/);
  assert.match(sql, /'pending'/);
  assert.match(sql, /'annual'/);
  assert.match(sql, /submitted_on_behalf/);
  assert.match(sql, /employee_profile_id/);
  assert.match(sql, /staff_leave_balance\(p_profile_id/);
  assert.match(sql, /staff_leave_lock_profile\(p_profile_id\)/);
  assert.match(sql, /staff_leave_has_blocking_overlap\(p_profile_id/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_staff_leave_request_for_profile/);
  assert.match(sql, /preview_staff_leave_request_days/);
  assert.match(sql, /staff_leave_assert_profile_access\(target_profile\)/);
  assert.match(sql, /staff_leave_count_request_days/);
  assert.doesNotMatch(sql, /decided_by/);
  assert.doesNotMatch(sql, /UPDATE public\.staff_leave_requests[\s\S]*'approved'/);
});

test("preview and request-days APIs use authoritative day-count RPC", async () => {
  const staffRoute = await readFile(
    new URL("../../app/api/staff/leave/request-days/route.ts", import.meta.url),
    "utf8"
  );
  const adminRoute = await readFile(
    new URL("../../app/api/admin/leave/request-days/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(staffRoute, /preview_staff_leave_request_days/);
  assert.match(adminRoute, /preview_staff_leave_request_days/);
  assert.match(adminRoute, /canDecideLeaveRequests/);
});

test("pending queue shows submitted-by label wiring", async () => {
  const queue = await readFile(
    new URL("../../components/staff-leave/admin-leave-pending-queue.tsx", import.meta.url),
    "utf8"
  );
  const queries = await readFile(
    new URL("../../lib/staff-leave/queries.ts", import.meta.url),
    "utf8"
  );

  assert.match(queue, /Submitted by/);
  assert.match(queries, /fetchSubmittedByLabelsForRequests/);
  assert.match(queries, /submitted_on_behalf/);
});

test("admin requests API rejects self on-behalf and calls new RPC", async () => {
  const source = await readFile(
    new URL("../../app/api/admin/leave/requests/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /canDecideLeaveRequests/);
  assert.match(source, /submit_staff_leave_request_for_profile/);
  assert.match(source, /body\.profileId === auth\.userId/);
  assert.match(source, /Book my holiday/);
});

test("admin leave page exposes booking controls without removing staff leave path", async () => {
  const adminPage = await readFile(
    new URL("../../app/admin/leave/page.tsx", import.meta.url),
    "utf8"
  );
  const staffPage = await readFile(
    new URL("../../app/staff/leave/page.tsx", import.meta.url),
    "utf8"
  );

  assert.match(adminPage, /AdminLeaveBooking/);
  const bookingUi = await readFile(
    new URL("../../components/staff-leave/admin-leave-booking.tsx", import.meta.url),
    "utf8"
  );
  assert.match(bookingUi, /Book my holiday/);
  assert.match(staffPage, /LeaveRequestForm/);
  assert.match(staffPage, /STAFF_LEAVE_PATH/);
});
