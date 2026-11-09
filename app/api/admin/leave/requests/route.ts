import { NextResponse } from "next/server";

import {
  canDecideLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { fetchLeaveRequestsForAdmin } from "@/lib/staff-leave/queries";
import { STAFF_LEAVE_FIRST_POLICY_YEAR } from "@/lib/staff-leave/types";
import { flushStaffLeaveNotifications } from "@/lib/staff-leave/notifications/flush";
import { createLeaveApiClient } from "@/lib/supabase/leave-api-client";

export const dynamic = "force-dynamic";

type SubmitOnBehalfBody = {
  profileId?: string;
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

export async function POST(request: Request) {
  const supabase = await createLeaveApiClient(request);
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canDecideLeaveRequests(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: SubmitOnBehalfBody;
  try {
    body = (await request.json()) as SubmitOnBehalfBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.profileId || !body.startDate || !body.endDate || !body.dayPortion) {
    return NextResponse.json(
      { error: "profileId, startDate, endDate, and dayPortion are required." },
      { status: 400 }
    );
  }

  if (body.profileId === auth.userId) {
    return NextResponse.json(
      {
        error:
          "Use Book my holiday on this page (or /staff/leave) for your own annual leave.",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("submit_staff_leave_request_for_profile", {
    p_profile_id: body.profileId,
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

  await flushStaffLeaveNotifications({ requestId: (data as { id: string }).id });

  return NextResponse.json({ request: data });
}
