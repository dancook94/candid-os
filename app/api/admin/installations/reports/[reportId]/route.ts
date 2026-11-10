import { NextResponse } from "next/server";

import { INSTALLATION_FILES_BUCKET } from "@/lib/installations/constants";
import { canManageInstallations } from "@/lib/installations/permissions";
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

  const { data: report, error } = await supabase
    .from("installation_completion_reports")
    .select("report_reference, storage_path")
    .eq("id", reportId)
    .maybeSingle();

  if (error || !report?.storage_path) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  const downloaded = await supabase.storage.from(INSTALLATION_FILES_BUCKET).download(report.storage_path);
  if (downloaded.error || !downloaded.data) {
    return NextResponse.json({ error: "Report file is not available." }, { status: 404 });
  }

  const bytes = await downloaded.data.arrayBuffer();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${report.report_reference}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
