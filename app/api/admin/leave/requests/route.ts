import { NextResponse } from "next/server";

import {
  canDecideLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { fetchLeaveRequestsForAdmin } from "@/lib/staff-leave/queries";
import { STAFF_LEAVE_FIRST_POLICY_YEAR } from "@/lib/staff-leave/types";
import { createLeaveApiClient } from "@/lib/supabase/leave-api-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createLeaveApiClient(request);
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canDecideLeaveRequests(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const status = searchParams.get("status");
  const holidayYear = yearParam ? Number(yearParam) : STAFF_LEAVE_FIRST_POLICY_YEAR;

  if (!Number.isInteger(holidayYear) || holidayYear < STAFF_LEAVE_FIRST_POLICY_YEAR) {
    return NextResponse.json({ error: "Invalid holiday year." }, { status: 400 });
  }

  const { requests, error } = await fetchLeaveRequestsForAdmin(supabase, {
    holidayYear,
    status,
  });

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({ requests });
}
