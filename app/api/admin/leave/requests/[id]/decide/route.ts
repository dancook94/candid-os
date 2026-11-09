import { NextResponse } from "next/server";

import {
  canDecideLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type DecideBody = {
  decision?: string;
  decisionNote?: string | null;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canDecideLeaveRequests(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: DecideBody;
  try {
    body = (await request.json()) as DecideBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be approved or rejected." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("decide_staff_leave_request", {
    p_request_id: id,
    p_decision: body.decision,
    p_decision_note: body.decisionNote ?? null,
  });

  if (error) {
    const status = /not awaiting approval|already decided/i.test(error.message) ? 409 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }

  return NextResponse.json({ request: data });
}
