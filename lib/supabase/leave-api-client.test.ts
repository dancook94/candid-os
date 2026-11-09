import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("leave API authentication", () => {
  it("Bearer path uses Supabase getUser() in route auth (JWT verified by Supabase)", async () => {
    const clientSource = await readFile(
      new URL("./leave-api-client.ts", import.meta.url),
      "utf8"
    );
    const authSource = await readFile(
      new URL("../staff-leave/auth.ts", import.meta.url),
      "utf8"
    );
    const balanceRoute = await readFile(
      new URL("../../app/api/staff/leave/balance/route.ts", import.meta.url),
      "utf8"
    );

    assert.match(clientSource, /createLeaveApiClient/);
    assert.match(clientSource, /Authorization.*Bearer/);
    assert.match(authSource, /supabase\.auth\.getUser\(\)/);
    assert.match(balanceRoute, /createLeaveApiClient/);
    assert.match(balanceRoute, /loadStaffLeaveAuthProfile/);
  });

  it("entitlement writes require admin in API and migration RLS", async () => {
    const routeSource = await readFile(
      new URL("../../app/api/admin/leave/entitlements/route.ts", import.meta.url),
      "utf8"
    );
    const migration = await readFile(
      new URL(
        "../../supabase/migrations/20270110120000_staff_leave_phase1.sql",
        import.meta.url
      ),
      "utf8"
    );

    assert.match(routeSource, /canDecideLeaveRequests/);
    assert.match(migration, /staff_leave_entitlements_admin_write/);
    assert.match(migration, /is_approved_candid_admin\(\)/);
  });

  it("staff leave UI does not query sickness tables", async () => {
    const staffPage = await readFile(
      new URL("../../app/staff/leave/page.tsx", import.meta.url),
      "utf8"
    );

    assert.doesNotMatch(staffPage, /sickness/i);
    assert.doesNotMatch(staffPage, /staff_absence/i);
  });
});
