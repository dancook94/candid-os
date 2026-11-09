import { NextResponse } from "next/server";

import {
  canDecideLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { loadStaffLeaveCalendarSyncStatus } from "@/lib/staff-leave/calendar-sync/status";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canDecideLeaveRequests(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  void request;

  const admin = createAdminClient();
  const status = await loadStaffLeaveCalendarSyncStatus(admin);

  return NextResponse.json({ ok: true, status });
}
