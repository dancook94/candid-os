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

  if (
    !Number.isInteger(holidayYear) ||
    holidayYear < STAFF_LEAVE_FIRST_POLICY_YEAR ||
    adjustmentDays < -50 ||
    adjustmentDays > 50
  ) {
    return NextResponse.json({ error: "Invalid entitlement values." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("staff_leave_entitlements")
    .upsert(
      {
        profile_id: profileId,
        holiday_year: holidayYear,
        adjustment_days: adjustmentDays,
        prorata_start_date: body.prorataStartDate ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,holiday_year" }
    )
    .select("id, adjustment_days, prorata_start_date")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ entitlement: data });
}
