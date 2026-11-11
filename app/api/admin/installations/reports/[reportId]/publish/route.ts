import { NextResponse } from "next/server";

import { canManageInstallations } from "@/lib/installations/permissions";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ reportId: string }> };

export async function POST(_request: Request, context: RouteContext) {
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

  const { data, error } = await supabase.rpc("installation_publish_completion_report", {
    p_report_id: reportId,
  });

  if (error) {
    const message = error.message.includes("Report not found")
      ? "Report not found."
      : error.message.includes("Forbidden")
        ? "Forbidden."
        : "The report could not be published.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(data ?? { saved: true, published: true });
}
