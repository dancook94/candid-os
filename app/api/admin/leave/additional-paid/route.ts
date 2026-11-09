import { NextResponse } from "next/server";

import {
  canDecideLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { flushStaffLeaveNotifications } from "@/lib/staff-leave/notifications/flush";
import { createLeaveApiClient } from "@/lib/supabase/leave-api-client";

export const dynamic = "force-dynamic";

type Body = {
  profileId?: string;
  startDate?: string;
  endDate?: string;
  dayPortion?: string;
  grantReason?: string;
  decisionNote?: string | null;
};

export async function POST(request: Request) {
  const supabase = await createLeaveApiClient(request);
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canDecideLeaveRequests(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.profileId || !body.startDate || !body.endDate || !body.dayPortion || !body.grantReason) {
    return NextResponse.json(
      { error: "profileId, dates, dayPortion and grantReason are required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("grant_staff_additional_paid_leave", {
    p_profile_id: body.profileId,
    p_start_date: body.startDate,
    p_end_date: body.endDate,
    p_day_portion: body.dayPortion,
    p_grant_reason: body.grantReason,
    p_decision_note: body.decisionNote ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }

  await flushStaffLeaveNotifications({ requestId: (data as { id: string }).id });

  return NextResponse.json({ request: data });
}
