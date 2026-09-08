import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import {
  updateProblemReportAdminFields,
  validateProblemReportAdminUpdate,
} from "@/lib/problem-reports/queries";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateProblemReportBody = {
  status?: string;
  adminNotes?: string;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id: reportId } = await context.params;
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: UpdateProblemReportBody;

  try {
    body = (await request.json()) as UpdateProblemReportBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validation = validateProblemReportAdminUpdate(body);

  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: 400 });
  }

  const result = await updateProblemReportAdminFields(supabase, reportId, {
    status: validation.value.status,
    adminNotes: validation.value.adminNotes,
    resolvedBy: authResult.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, report: result.report });
}
