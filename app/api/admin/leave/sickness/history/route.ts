import { NextResponse } from "next/server";

import { canRecordSickness, loadStaffLeaveAuthProfile } from "@/lib/staff-leave/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canRecordSickness(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId");
  const yearParam = searchParams.get("year");

  if (!profileId) {
    return NextResponse.json({ error: "profileId is required." }, { status: 400 });
  }

  const holidayYear = yearParam ? Number(yearParam) : null;
  if (yearParam && (!Number.isInteger(holidayYear) || holidayYear! < 2027)) {
    return NextResponse.json({ error: "Invalid holiday year." }, { status: 400 });
  }

  const [{ data: records, error: listError }, { data: total, error: totalError }] =
    await Promise.all([
      supabase.rpc("list_staff_absence_sickness_admin", {
        p_profile_id: profileId,
        p_holiday_year: holidayYear,
      }),
      supabase.rpc("staff_absence_sickness_year_total", {
        p_profile_id: profileId,
        p_holiday_year: holidayYear ?? new Date().getFullYear(),
      }),
    ]);

  if (listError || totalError) {
    return NextResponse.json(
      { error: listError?.message ?? totalError?.message },
      { status: 400 }
    );
  }

  return NextResponse.json({
    records: records ?? [],
    yearTotalDays: total ?? 0,
  });
}
