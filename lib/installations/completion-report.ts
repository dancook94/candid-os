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

const PHOTO_GAP = 14;
const FULL_MAX_HEIGHT = 220;
const PAIR_MAX_HEIGHT = 190;
const MIN_PAIR_HEIGHT = 72;
const PANORAMA_RATIO = 3.4;
const CAPTION_ALLOWANCE = 40;
const MIN_PHOTO_SCALE = 0.78;

export type PhotographFrame = {
  width: number;
  height: number;
  group: number;
};

export type PlannedPhotographRow = {
  page: number;
  indexes: number[];
  columns: 1 | 2;
  maxHeight: number;
  showSection: boolean;
  showPhase: boolean;
};

function photographCellWidth(contentWidth: number, columns: 1 | 2) {
  return columns === 1 ? contentWidth : (contentWidth - PHOTO_GAP) / 2;
}

function containedPhotoHeight(frame: PhotographFrame, cellWidth: number, maxHeight: number) {
  const scale = Math.min(cellWidth / frame.width, maxHeight / frame.height);
  return frame.height * scale;
}

function canSharePhotographRow(left: PhotographFrame, right: PhotographFrame, contentWidth: number) {
  const cell = photographCellWidth(contentWidth, 2);
  const readable = (frame: PhotographFrame) => {
    if (frame.width / frame.height > PANORAMA_RATIO) return false;
    return containedPhotoHeight(frame, cell, PAIR_MAX_HEIGHT) >= MIN_PAIR_HEIGHT;
  };
  return readable(left) && readable(right);
}

function photographRowHeight(
  frames: PhotographFrame[],
  indexes: number[],
  columns: 1 | 2,
  contentWidth: number,
  scale: number,
  heading: number
) {
  const maxHeight = (columns === 1 ? FULL_MAX_HEIGHT : PAIR_MAX_HEIGHT) * scale;
  const cell = photographCellWidth(contentWidth, columns);
  const imageHeight = Math.max(...indexes.map((index) => containedPhotoHeight(frames[index], cell, maxHeight)));
  return imageHeight + CAPTION_ALLOWANCE + heading;
}

export function planPhotographRows(
  frames: PhotographFrame[],
  options: {
    contentWidth: number;
    firstBudget: number;
    pageBudget: number;
    sectionHeading?: number;
    phaseHeading?: number;
  }
): PlannedPhotographRow[] {
  const sectionHeading = options.sectionHeading ?? 0;
  const phaseHeading = options.phaseHeading ?? 0;
  const logical: { indexes: number[]; columns: 1 | 2; heading: number; phase: boolean; section: boolean }[] = [];

  for (let index = 0; index < frames.length; ) {
    const current = frames[index];
    const next = frames[index + 1];
    const paired = Boolean(next && next.group === current.group && canSharePhotographRow(current, next, options.contentWidth));
    const indexes = paired ? [index, index + 1] : [index];
    const previous = logical.at(-1);
    const newPhase = !previous || frames[previous.indexes[0]].group !== current.group;
    logical.push({
      indexes,
      columns: paired ? 2 : 1,
      heading: (logical.length === 0 ? sectionHeading : 0) + (newPhase ? phaseHeading : 0),
      phase: newPhase,
      section: logical.length === 0,
    });
    index += indexes.length;
  }

  const pages: { rows: typeof logical; scale: number }[] = [];
  let budget = options.firstBudget;
  let currentRows: typeof logical = [];
  let used = 0;
  let firstPageSkipped = false;

  for (const row of logical) {
    const cost = photographRowHeight(frames, row.indexes, row.columns, options.contentWidth, 1, row.heading);
    if (pages.length === 0 && currentRows.length === 0 && cost > budget && cost <= options.pageBudget) {
      firstPageSkipped = true;
      budget = options.pageBudget;
    }
    if (currentRows.length > 0 && used + cost > budget) {
      pages.push({ rows: currentRows, scale: 1 });
      currentRows = [];
      used = 0;
      budget = options.pageBudget;
    }
    currentRows.push(row);
    used += cost;
  }
  if (currentRows.length > 0) pages.push({ rows: currentRows, scale: 1 });

  while (pages.length > 1 && pages.at(-1)!.rows.length === 1) {
    const previous = pages.at(-2)!;
    const previousBudget = pages.length === 2 && !firstPageSkipped ? options.firstBudget : options.pageBudget;
    const orphan = pages.at(-1)!.rows[0];
    const combined = [...previous.rows, orphan];
    let fitted: number | null = null;
    for (let step = 0; step <= 12; step += 1) {
      const scale = 1 - step * ((1 - MIN_PHOTO_SCALE) / 12);
      const cost = combined.reduce(
        (total, row) =>
          total + photographRowHeight(frames, row.indexes, row.columns, options.contentWidth, scale, row.heading),
        0
      );
      if (cost <= previousBudget) {
        fitted = scale;
        break;
      }
    }
    if (fitted == null) break;
    previous.rows = combined;
    previous.scale = Math.min(previous.scale, fitted);
    pages.pop();
  }

  const pageOffset = firstPageSkipped ? 1 : 0;
  return pages.flatMap((page, pageNumber) =>
    page.rows.map((row) => ({
      page: pageNumber + pageOffset,
      indexes: row.indexes,
      columns: row.columns,
      maxHeight: (row.columns === 1 ? FULL_MAX_HEIGHT : PAIR_MAX_HEIGHT) * page.scale,
      showSection: row.section,
      showPhase: row.phase,
    }))
  );
}

export function quoteReferenceLabel(quoteNumber: number | null | undefined) {
  if (typeof quoteNumber !== "number") {
    return null;
  }

  return `Q-${quoteNumber}`;
}
