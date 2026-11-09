import { NextResponse } from "next/server";

import {
  canSubmitLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { flushStaffLeaveNotifications } from "@/lib/staff-leave/notifications/flush";
import { createLeaveApiClient } from "@/lib/supabase/leave-api-client";

export const dynamic = "force-dynamic";

type Body = {
  startDate?: string;
  endDate?: string;
  dayPortion?: string;
  employeeNote?: string | null;
};

export async function POST(request: Request) {
  const supabase = await createLeaveApiClient(request);
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canSubmitLeaveRequests(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.startDate || !body.endDate || !body.dayPortion) {
    return NextResponse.json(
      { error: "startDate, endDate, and dayPortion are required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("submit_staff_additional_paid_leave_request", {
    p_start_date: body.startDate,
    p_end_date: body.endDate,
    p_day_portion: body.dayPortion,
    p_employee_note: body.employeeNote ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }

  await flushStaffLeaveNotifications({ requestId: (data as { id: string }).id });

  return NextResponse.json({ request: data });
}
