import { NextResponse } from "next/server";

import {
  canDecideLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import { flushStaffLeaveNotifications } from "@/lib/staff-leave/notifications/flush";
import { createLeaveApiClient } from "@/lib/supabase/leave-api-client";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CancelBody = {
  cancellationNote?: string | null;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createLeaveApiClient(request);
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canDecideLeaveRequests(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: CancelBody = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      body = JSON.parse(text) as CancelBody;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("cancel_staff_leave_request", {
    p_request_id: id,
    p_cancellation_note: body.cancellationNote ?? null,
  });

  if (error) {
    const status = /already cancelled|cannot be cancelled|not found/i.test(error.message)
      ? 409
      : /only pending or approved/i.test(error.message)
        ? 409
        : /cancellation reason is required/i.test(error.message)
          ? 400
          : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }

  await flushStaffLeaveNotifications({ requestId: (data as { id: string }).id });

  return NextResponse.json({ request: data });
}
