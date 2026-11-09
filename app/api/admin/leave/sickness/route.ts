import { NextResponse } from "next/server";

import {
  canRecordSickness,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RecordSicknessBody = {
  profileId?: string;
  startDate?: string;
  endDate?: string;
  dayPortion?: string;
  reason?: string | null;
  note?: string | null;
  privateNote?: string | null;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canRecordSickness(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: RecordSicknessBody;
  try {
    body = (await request.json()) as RecordSicknessBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.profileId || !body.startDate || !body.endDate || !body.dayPortion) {
    return NextResponse.json(
      { error: "profileId, startDate, endDate, and dayPortion are required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("record_staff_absence_sickness", {
    p_profile_id: body.profileId,
    p_start_date: body.startDate,
    p_end_date: body.endDate,
    p_day_portion: body.dayPortion,
    p_reason: body.reason ?? null,
    p_note: body.note ?? null,
    p_private_note: body.privateNote ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }

  return NextResponse.json({ sickness: data });
}
