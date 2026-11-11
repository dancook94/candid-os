import { NextResponse } from "next/server";

import {
  loadInstallationReportSendContext,
  loadInstallationReportSendRecipients,
  previewInstallationReportEmail,
} from "@/lib/installations/report-delivery";
import { assessInstallationReportRecipientPortalAccess } from "@/lib/installations/report-recipients";
import { canManageInstallations } from "@/lib/installations/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ reportId: string }> };

export async function POST(request: Request, context: RouteContext) {
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

  const body = (await request.json().catch(() => ({}))) as {
    message?: string;
    recipientEmail?: string;
  };
  const adminClient = createAdminClient();

  try {
    const contextData = await loadInstallationReportSendContext(adminClient, reportId);
    const preview = previewInstallationReportEmail(contextData, body.message);
    const recipients = await loadInstallationReportSendRecipients(adminClient, contextData);
    const recipientEmail = body.recipientEmail?.trim() || contextData.defaultRecipientEmail || "";
    const portal =
      recipientEmail.length > 0
        ? await assessInstallationReportRecipientPortalAccess(adminClient, {
            companyId: contextData.companyId,
            recipientEmail,
          })
        : null;
    return NextResponse.json({
      subject: preview.subject,
      html: preview.html,
      defaultRecipientEmail: contextData.defaultRecipientEmail,
      reportReference: contextData.reportReference,
      recipients,
      recipientPortalAccess: portal,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The email could not be previewed." },
      { status: 400 }
    );
  }
}
