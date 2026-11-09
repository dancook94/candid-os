import { NextResponse } from "next/server";

import {
  canDecideLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { createLeaveApiClient } from "@/lib/supabase/leave-api-client";

export const dynamic = "force-dynamic";

type Body = {
  profileId?: string;
  effectiveFrom?: string;
  worksMon?: boolean;
  worksTue?: boolean;
  worksWed?: boolean;
  worksThu?: boolean;
  worksFri?: boolean;
  worksSat?: boolean;
  worksSun?: boolean;
  fteRatio?: number;
  changeNote?: string;
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

  if (!body.profileId || !body.effectiveFrom || typeof body.fteRatio !== "number") {
    return NextResponse.json({ error: "profileId, effectiveFrom and fteRatio are required." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("set_staff_working_pattern", {
    p_profile_id: body.profileId,
    p_effective_from: body.effectiveFrom,
    p_works_mon: Boolean(body.worksMon),
    p_works_tue: Boolean(body.worksTue),
    p_works_wed: Boolean(body.worksWed),
    p_works_thu: Boolean(body.worksThu),
    p_works_fri: Boolean(body.worksFri),
    p_works_sat: Boolean(body.worksSat),
    p_works_sun: Boolean(body.worksSun),
    p_fte_ratio: body.fteRatio,
    p_change_note: body.changeNote ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }

  return NextResponse.json({ pattern: data });
}
