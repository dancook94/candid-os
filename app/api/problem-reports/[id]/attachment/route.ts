import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import {
  createProblemReportAttachmentSignedUrl,
  fetchProblemReportAttachment,
  uploadProblemReportAttachment,
} from "@/lib/problem-reports/attachments";
import { fetchProblemReportById } from "@/lib/problem-reports/queries";
import { getUpdatesPageAccess } from "@/lib/updates/page-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function canAccessReport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reportId: string,
  userId: string
) {
  const { report } = await fetchProblemReportById(supabase, reportId);

  if (!report) {
    return { allowed: false as const, status: 404, message: "Report not found." };
  }

  if (report.reporter_id === userId) {
    return { allowed: true as const, report };
  }

  const adminCheck = await verifyApprovedAdmin(supabase);

  if (!adminCheck.ok) {
    return { allowed: false as const, status: 403, message: "Forbidden." };
  }

  return { allowed: true as const, report };
}

export async function GET(_request: Request, context: RouteContext) {
  const { id: reportId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const access = await canAccessReport(supabase, reportId, user.id);

  if (!access.allowed) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  const { attachment, error } = await fetchProblemReportAttachment(
    supabase,
    reportId
  );

  if (error || !attachment) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  let signedClient = supabase;

  try {
    signedClient = createAdminClient();
  } catch {
    signedClient = supabase;
  }

  const signed = await createProblemReportAttachmentSignedUrl(
    signedClient,
    attachment.storage_path
  );

  if (!signed.signedUrl) {
    return NextResponse.json(
      { error: signed.error ?? "Unable to create download link." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    fileName: attachment.file_name,
    signedUrl: signed.signedUrl,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { id: reportId } = await context.params;
  const supabase = await createClient();
  const pageAccess = await getUpdatesPageAccess(supabase);

  if (!pageAccess.ok) {
    return NextResponse.json(
      { error: pageAccess.message },
      { status: pageAccess.status }
    );
  }

  const { user } = pageAccess;

  const reportAccess = await canAccessReport(supabase, reportId, user.id);

  if (!reportAccess.allowed || reportAccess.report.reporter_id !== user.id) {
    return NextResponse.json(
      { error: reportAccess.allowed ? "Forbidden." : reportAccess.message },
      { status: reportAccess.allowed ? 403 : reportAccess.status }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attachment file is required." }, { status: 400 });
  }

  const existing = await fetchProblemReportAttachment(supabase, reportId);

  if (existing.attachment) {
    return NextResponse.json(
      { error: "This report already has an attachment." },
      { status: 409 }
    );
  }

  let uploadClient;

  try {
    uploadClient = createAdminClient();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to initialise upload client.",
      },
      { status: 500 }
    );
  }

  const result = await uploadProblemReportAttachment(uploadClient, {
    reportId,
    uploadedBy: user.id,
    file,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
