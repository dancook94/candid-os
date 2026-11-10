import { NextResponse } from "next/server";

import { INSTALLATION_FILES_BUCKET } from "@/lib/installations/constants";
import { createAdminClient } from "@/lib/supabase/admin";

export const REPORT_PDF_INLINE_LIMIT = 3_500_000;
export const REPORT_PREVIEW_URL_SECONDS = 600;
export const REPORT_PREVIEW_KEEP = 8;

const VISIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i;

export function reportFitsInline(byteLength: number) {
  return byteLength <= REPORT_PDF_INLINE_LIMIT;
}

export function inlineReportResponse(bytes: Uint8Array, filename: string, disposition: "inline" | "attachment") {
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export function buildInstallationReportPreviewPath(visitId: string, previewId: string) {
  if (!VISIT_ID.test(visitId) || !VISIT_ID.test(previewId)) {
    throw new Error("The report preview could not be stored.");
  }
  return `${visitId}/previews/${previewId}.pdf`;
}

export function installationPreviewFilesToRemove(
  files: { name: string; createdAt: string | null }[],
  options: { now: number; retainName: string; keep: number; lifetimeMs: number }
) {
  const ranked = files
    .filter((file) => PREVIEW_FILE.test(file.name))
    .map((file) => ({
      name: file.name,
      createdAt: file.createdAt ? Date.parse(file.createdAt) : Number.NaN,
    }))
    .sort((left, right) => (Number.isFinite(right.createdAt) ? right.createdAt : 0) - (Number.isFinite(left.createdAt) ? left.createdAt : 0));
  const fresh = ranked.filter(
    (file) => Number.isFinite(file.createdAt) && options.now - file.createdAt <= options.lifetimeMs
  );
  const retained = new Set(fresh.slice(0, options.keep).map((file) => file.name));
  retained.add(options.retainName);
  return ranked.filter((file) => !retained.has(file.name)).map((file) => file.name);
}

export async function privateReportPreviewUrl(visitId: string, bytes: Uint8Array) {
  const previewId = crypto.randomUUID();
  const path = buildInstallationReportPreviewPath(visitId, previewId);
  const admin = createAdminClient();
  const uploaded = await admin.storage.from(INSTALLATION_FILES_BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploaded.error) {
    throw new Error("The report preview could not be stored for download.");
  }
  const signed = await admin.storage.from(INSTALLATION_FILES_BUCKET).createSignedUrl(path, REPORT_PREVIEW_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error("The report preview could not be authorised for download.");
  }
  await removeStaleInstallationPreviews(admin, visitId, `${previewId}.pdf`);
  return signed.data.signedUrl;
}

async function removeStaleInstallationPreviews(
  admin: ReturnType<typeof createAdminClient>,
  visitId: string,
  retainName: string
) {
  try {
    const listed = await admin.storage.from(INSTALLATION_FILES_BUCKET).list(`${visitId}/previews`, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (listed.error || !listed.data) return;
    const names = installationPreviewFilesToRemove(
      listed.data.map((file) => ({ name: file.name, createdAt: file.created_at ?? null })),
      {
        now: Date.now(),
        retainName,
        keep: REPORT_PREVIEW_KEEP,
        lifetimeMs: REPORT_PREVIEW_URL_SECONDS * 1000,
      }
    );
    if (names.length === 0) return;
    await admin.storage.from(INSTALLATION_FILES_BUCKET).remove(names.map((name) => `${visitId}/previews/${name}`));
  } catch {
    // The preview URL is already issued. A cleanup failure must not discard it.
  }
}
