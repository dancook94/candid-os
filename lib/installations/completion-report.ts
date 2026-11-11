import { isOutstandingInstallationSnag } from "@/lib/installations/job-signal";

export type InstallationReportPhotoRef = {
  id: string;
};

export function formatInstallationReportReference(
  jobReference: string | null | undefined,
  visitNumber: number,
  versionNumber: number
) {
  const cleaned = (jobReference ?? "").replace(/[^A-Za-z0-9-]+/g, "");
  return `ICR-${cleaned || "VISIT"}-V${visitNumber}.${versionNumber}`;
}

export function buildInstallationReportPath(visitId: string, versionNumber: number, reportReference: string) {
  const fileName = reportReference.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${visitId}/reports/v${versionNumber}/${fileName}.pdf`;
}

export function selectInstallationReportPhotos<T extends InstallationReportPhotoRef>(
  photos: readonly T[],
  selectedIds: readonly string[] | null
) {
  if (selectedIds === null) {
    return [...photos];
  }

  const wanted = new Set(selectedIds);
  return photos.filter((photo) => wanted.has(photo.id));
}

export function checklistReportValues(checklist: {
  siteLeftSafeAndTidy?: boolean;
  installationPhotosRecorded?: boolean;
} | null) {
  return {
    siteLeftSafeAndTidy: checklist?.siteLeftSafeAndTidy === true,
    installationPhotosRecorded: checklist?.installationPhotosRecorded === true,
  };
}

export function installationReportSnagStatement(outstandingCount: number, snagCount: number) {
  if (outstandingCount > 0) {
    return "Outstanding snags remain on this visit.";
  }

  if (snagCount === 0) {
    return "No snags were recorded for this visit.";
  }

  return "No outstanding snags remain. Resolved items are listed below.";
}

export function installationReportScopeStatement(visitNumber: number, projectStatus: string) {
  return `This report covers visit ${visitNumber} only. It does not complete the installation project (${projectStatus}).`;
}

export const OFFICIAL_REPORT_SIGN_OFF_REQUIRED =
  "Record the visit sign-off before saving the completion report.";

export function hasOfficialInstallationSignOff(signOff: {
  customerAttendance?: string | null;
  customerName?: string | null;
  declineReason?: string | null;
  signatureStoragePath?: string | null;
  checklist?: {
    siteLeftSafeAndTidy?: boolean;
    installationPhotosRecorded?: boolean;
  } | null;
} | null | undefined) {
  if (!signOff?.checklist) {
    return false;
  }

  if (signOff.checklist.siteLeftSafeAndTidy !== true || signOff.checklist.installationPhotosRecorded !== true) {
    return false;
  }

  if (signOff.customerAttendance === "present") {
    return Boolean(signOff.customerName?.trim()) && Boolean(signOff.signatureStoragePath);
  }

  if (signOff.customerAttendance === "absent") {
    return !signOff.signatureStoragePath;
  }

  if (signOff.customerAttendance === "declined") {
    return Boolean(signOff.declineReason?.trim()) && !signOff.signatureStoragePath;
  }

  return false;
}

export function countOutstandingSnags(statuses: readonly string[]) {
  return statuses.filter((status) => isOutstandingInstallationSnag(status)).length;
}

const INTERNAL_REPORT_VALUES = new Set([
  "quote_reconcile",
  "manual",
  "draft",
  "unscheduled",
  "en_route",
  "on_site",
  "wont_fix",
]);

export function customerFacingReportText(value: string | null | undefined) {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return null;
  if (INTERNAL_REPORT_VALUES.has(text.toLowerCase())) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return null;
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(text)) return null;
  return text;
}

function sameReportText(left: string, right: string | null) {
  return right != null && left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

export function customerFacingWorkSummary(input: {
  projectTitle?: string | null;
  visitTitle?: string | null;
  jobName?: string | null;
  description?: string | null;
  completionNotes?: string | null;
  siteContact?: string | null;
  siteAccess?: string | null;
}) {
  const description = customerFacingReportText(input.description);
  const titles = [input.projectTitle, input.visitTitle, input.jobName]
    .map((value) => customerFacingReportText(value))
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.findIndex((other) => sameReportText(value, other)) === index);
  const primary = description ?? titles[0] ?? null;
  const items: { label: string; value: string }[] = [];
  if (primary) items.push({ label: "Work completed", value: primary });
  const notes = customerFacingReportText(input.completionNotes);
  if (notes && !sameReportText(notes, primary)) items.push({ label: "Completion notes", value: notes });
  const access = customerFacingReportText(input.siteAccess);
  if (access && !sameReportText(access, primary)) items.push({ label: "Site access", value: access });
  const contact = customerFacingReportText(input.siteContact);
  if (contact) items.push({ label: "Site contact", value: contact });
  return items;
}

export function quoteReferenceLabel(quoteNumber: number | null | undefined) {
  if (typeof quoteNumber !== "number") {
    return null;
  }

  return `Q-${quoteNumber}`;
}
