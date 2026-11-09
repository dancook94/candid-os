import { NextResponse } from "next/server";

import {
  canSubmitLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { createLeaveApiClient } from "@/lib/supabase/leave-api-client";

export const dynamic = "force-dynamic";

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
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const dayPortion = searchParams.get("dayPortion");

  if (!startDate || !endDate || !dayPortion) {
    return NextResponse.json(
      { error: "startDate, endDate, and dayPortion are required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("preview_staff_leave_request_days", {
    target_profile: auth.userId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_day_portion: dayPortion,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ days: Number(data) });
}
