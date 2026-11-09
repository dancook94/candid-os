import { NextResponse } from "next/server";

import {
  canDecideLeaveRequests,
  loadStaffLeaveAuthProfile,
} from "@/lib/staff-leave/auth";
import {
  enqueueStaffLeaveCalendarReconciliation,
  scanStaffLeaveCalendarReconciliation,
} from "@/lib/staff-leave/calendar-sync/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ReconcileBody = {
  dryRun?: boolean;
  enqueue?: boolean;
  includeGoogleRefresh?: boolean;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await loadStaffLeaveAuthProfile(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!canDecideLeaveRequests(auth.profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: ReconcileBody = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      body = JSON.parse(text) as ReconcileBody;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const admin = createAdminClient();
  const scan = await scanStaffLeaveCalendarReconciliation(admin, {
    targetGoogleProvider: body.includeGoogleRefresh,
  });

  const dryRun = body.dryRun ?? !body.enqueue;

  const enqueue = dryRun
    ? {
        dryRun: true,
        enqueued: 0,
        skipped: scan.findings.length,
        findings: scan.findings,
      }
    : await enqueueStaffLeaveCalendarReconciliation(admin, {
        dryRun: false,
        includeGoogleRefresh: body.includeGoogleRefresh,
      });

  return NextResponse.json({
    ok: true,
    scan,
    enqueue,
  });
}
