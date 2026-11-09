import { NextResponse } from "next/server";

import {
  canDecideLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { STAFF_LEAVE_FIRST_POLICY_YEAR } from "@/lib/staff-leave/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId") ?? auth.userId;
  const yearParam = searchParams.get("year");
  const holidayYear = yearParam ? Number(yearParam) : STAFF_LEAVE_FIRST_POLICY_YEAR;

  if (!Number.isInteger(holidayYear) || holidayYear < STAFF_LEAVE_FIRST_POLICY_YEAR) {
    return NextResponse.json({ error: "Invalid holiday year." }, { status: 400 });
  }

  if (profileId !== auth.userId && !canDecideLeaveRequests(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("staff_leave_balance", {
    target_profile: profileId,
    p_holiday_year: holidayYear,
  });

  if (error) {
    const status = /Forbidden|Unauthorized/i.test(error.message) ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  const row = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({ balance: row });
}
