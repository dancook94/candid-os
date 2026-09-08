import { NextResponse } from "next/server";

import {
  createProblemReport,
  validateProblemReportSubmission,
} from "@/lib/problem-reports/queries";
import {
  getUpdatesPageAccess,
  resolveReporterContext,
} from "@/lib/updates/page-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SubmitProblemReportBody = {
  description?: string;
  attemptedAction?: string;
  priority?: string;
  sourcePath?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const access = await getUpdatesPageAccess(supabase);

  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  const { user, profile } = access;

  let body: SubmitProblemReportBody;

  try {
    body = (await request.json()) as SubmitProblemReportBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validation = validateProblemReportSubmission({
    description: body.description,
    attemptedAction: body.attemptedAction,
    priority: body.priority,
    sourcePath: body.sourcePath,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: 400 });
  }

  const reporter = resolveReporterContext(user, profile);
  const userAgent = request.headers.get("user-agent");

  let adminClient;

  try {
    adminClient = createAdminClient();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to initialise admin client.",
      },
      { status: 500 }
    );
  }

  const result = await createProblemReport(adminClient, {
    reporterId: reporter.reporterId,
    reporterName: reporter.reporterName,
    reporterEmail: reporter.reporterEmail,
    reporterRole: reporter.reporterRole,
    companyId: reporter.companyId,
    description: validation.value.description,
    attemptedAction: validation.value.attemptedAction,
    priority: validation.value.priority,
    sourcePath: validation.value.sourcePath,
    userAgent,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    reportId: result.report.id,
    message: "Thank you. Your problem report has been submitted.",
  });
}
