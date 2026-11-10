import { NextResponse } from "next/server";

import {
  assertVisitReadyForOfficialReport,
  buildVisitCompletionReport,
  removeUnregisteredReport,
  reportReferenceFromPreview,
  uploadCompletionReport,
} from "@/lib/installations/completion-report-service";
import { canManageInstallations } from "@/lib/installations/permissions";
import { inlineReportResponse, privateReportPreviewUrl, reportFitsInline } from "@/lib/installations/report-pdf-response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ visitId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { visitId } = await context.params;
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

  const body = (await request.json().catch(() => null)) as { photoIds?: unknown; persist?: unknown } | null;
  const selectedPhotoIds = Array.isArray(body?.photoIds)
    ? body.photoIds.filter((id): id is string => typeof id === "string")
    : null;
  const persist = body?.persist === true;
  const admin = createAdminClient();

  try {
    if (!persist) {
      const previewResult = await supabase.rpc("installation_completion_report_next", {
        p_visit_id: visitId,
      });
      if (previewResult.error) {
        return NextResponse.json({ error: previewResult.error.message }, { status: 400 });
      }
      const preview = reportReferenceFromPreview(previewResult.data);
      if (!preview) {
        return NextResponse.json({ error: "The report reference could not be prepared." }, { status: 400 });
      }
      const report = await buildVisitCompletionReport({
        admin,
        visitId,
        selectedPhotoIds,
        versionNumber: preview.versionNumber,
        reportReference: preview.reportReference,
      });
      if (reportFitsInline(report.bytes.byteLength)) {
        return inlineReportResponse(report.bytes, `${preview.reportReference}.pdf`, "inline");
      }
      const previewUrl = await privateReportPreviewUrl(visitId, report.bytes);
      return NextResponse.json({ previewUrl });
    }

    await assertVisitReadyForOfficialReport(admin, visitId);

    let lastError = "The report could not be saved.";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const previewResult = await supabase.rpc("installation_completion_report_next", { p_visit_id: visitId });
      if (previewResult.error) {
        return NextResponse.json({ error: previewResult.error.message }, { status: 403 });
      }
      const preview = reportReferenceFromPreview(previewResult.data);
      if (!preview) {
        return NextResponse.json({ error: "The report could not be prepared." }, { status: 400 });
      }
      const report = await buildVisitCompletionReport({
        admin,
        visitId,
        selectedPhotoIds,
        versionNumber: preview.versionNumber,
        reportReference: preview.reportReference,
      });
      await uploadCompletionReport(supabase, report.storagePath, report.bytes);
      const saved = await supabase.rpc("installation_register_completion_report", {
        p_visit_id: visitId,
        p_storage_path: report.storagePath,
        p_byte_size: report.bytes.byteLength,
        p_included_photo_ids: report.includedPhotoIds,
      });
      if (!saved.error && saved.data) {
        return NextResponse.json({
          id: saved.data,
          reportReference: preview.reportReference,
          versionNumber: preview.versionNumber,
        });
      }
      await removeUnregisteredReport(supabase, report.storagePath);
      lastError = saved.error?.message || lastError;
      if (!/version changed/i.test(lastError)) {
        break;
      }
    }

    return NextResponse.json({ error: lastError }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The report could not be generated.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
