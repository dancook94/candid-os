import { NextResponse } from "next/server";

import {
  canSubmitLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { fetchOwnLeaveRequests } from "@/lib/staff-leave/queries";
import { STAFF_LEAVE_FIRST_POLICY_YEAR } from "@/lib/staff-leave/types";
import { createLeaveApiClient } from "@/lib/supabase/leave-api-client";

export const dynamic = "force-dynamic";

type SubmitLeaveBody = {
  startDate?: string;
  endDate?: string;
  dayPortion?: string;
  employeeNote?: string | null;
};

export async function GET(request: Request) {
  const supabase = await createLeaveApiClient(request);
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canSubmitLeaveRequests(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const holidayYear = yearParam ? Number(yearParam) : STAFF_LEAVE_FIRST_POLICY_YEAR;

  if (!Number.isInteger(holidayYear) || holidayYear < STAFF_LEAVE_FIRST_POLICY_YEAR) {
    return NextResponse.json({ error: "Invalid holiday year." }, { status: 400 });
  }

  const { requests, error } = await fetchOwnLeaveRequests(
    supabase,
    auth.userId,
    holidayYear
  );

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({ requests });
}

export async function POST(request: Request) {
  const supabase = await createLeaveApiClient(request);
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canSubmitLeaveRequests(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: SubmitLeaveBody;
  try {
    body = (await request.json()) as SubmitLeaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.startDate || !body.endDate || !body.dayPortion) {
    return NextResponse.json(
      { error: "startDate, endDate, and dayPortion are required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("submit_staff_leave_request", {
    p_start_date: body.startDate,
    p_end_date: body.endDate,
    p_day_portion: body.dayPortion,
    p_employee_note: body.employeeNote ?? null,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 400 }
    );
  }

  return NextResponse.json({ request: data });
}
