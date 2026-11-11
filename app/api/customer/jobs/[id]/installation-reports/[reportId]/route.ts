import { NextResponse } from "next/server";

import {
  downloadCustomerPublishedReportBytes,
  loadCustomerPublishedInstallationReportFile,
} from "@/lib/installations/customer-reports";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireCustomerJobContext } from "@/lib/jobs/auth";
import { inlineReportResponse } from "@/lib/installations/report-pdf-response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; reportId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id: jobId, reportId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const jobContext = await requireCustomerJobContext(supabase, user, jobId);
    const adminClient = createAdminClient();
    const file = await loadCustomerPublishedInstallationReportFile(adminClient, {
      jobId,
      companyId: jobContext.company.id,
      reportId,
    });

    const url = new URL(request.url);
    const inline = url.searchParams.get("inline") === "1";

    const bytes = await downloadCustomerPublishedReportBytes(adminClient, file);
    return inlineReportResponse(
      bytes,
      `${file.reportReference}.pdf`,
      inline ? "inline" : "attachment"
    );
  } catch (error) {
    return jobErrorResponse(error);
  }
}
