import { NextResponse } from "next/server";

import { listInstallationReportPublicationEvents } from "@/lib/installations/report-publication-history";
import { canManageInstallations } from "@/lib/installations/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ reportId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { reportId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_status, user_role")
    .eq("id", user.id)
    .single();

  if (!canManageInstallations(profile)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    const adminClient = createAdminClient();
    const { data: report, error } = await adminClient
      .from("installation_completion_reports")
      .select("installation_visit_id")
      .eq("id", reportId)
      .maybeSingle();
    if (error || !report?.installation_visit_id) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }
    const events = await listInstallationReportPublicationEvents(
      adminClient,
      String(report.installation_visit_id)
    );
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Publication history is not available." },
      { status: 400 }
    );
  }
}
