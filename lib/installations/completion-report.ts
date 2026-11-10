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

export function quoteReferenceLabel(quoteNumber: number | null | undefined) {
  if (typeof quoteNumber !== "number") {
    return null;
  }

  return `Q-${quoteNumber}`;
}
