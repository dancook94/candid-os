import { NextResponse } from "next/server";

import {
  canDecideLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { STAFF_LEAVE_FIRST_POLICY_YEAR } from "@/lib/staff-leave/types";
import { createLeaveApiClient } from "@/lib/supabase/leave-api-client";

export const dynamic = "force-dynamic";

type EntitlementBody = {
  profileId?: string;
  holidayYear?: number;
  adjustmentDays?: number;
  prorataStartDate?: string | null;
  adjustmentReason?: string | null;
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

  let body: EntitlementBody;
  try {
    body = (await request.json()) as EntitlementBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const profileId = body.profileId;
  const holidayYear = body.holidayYear ?? STAFF_LEAVE_FIRST_POLICY_YEAR;
  const adjustmentDays = body.adjustmentDays;

  if (!profileId || typeof adjustmentDays !== "number") {
    return NextResponse.json(
      { error: "profileId and adjustmentDays are required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("set_staff_leave_entitlement", {
    p_profile_id: profileId,
    p_holiday_year: holidayYear,
    p_adjustment_days: adjustmentDays,
    p_prorata_start_date: body.prorataStartDate ?? null,
    p_adjustment_reason: body.adjustmentReason ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }

  return NextResponse.json({ entitlement: data });
}
