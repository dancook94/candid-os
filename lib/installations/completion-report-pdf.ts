import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import {
  installationReportScopeStatement,
  installationReportSnagStatement,
  planPhotographRows,
} from "@/lib/installations/completion-report";
import { COMPLETION_CHECKLIST } from "@/lib/installations/completion";
import {
  detectReportImageKind,
  orientedPixelSize,
  placeOrientedPhotograph,
  prepareReportPhotograph,
  unreadableReportPhotographMessage,
} from "@/lib/installations/report-image";
import { embedCandidLogo } from "@/lib/proof-generator/pdf-layout";
import { sanitizePdfText } from "@/lib/proof-generator/pdf-text";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const FOOTER_HEIGHT = 36;
const CONTENT_BOTTOM = MARGIN + FOOTER_HEIGHT;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const ink = rgb(0.118, 0.118, 0.11);
const muted = rgb(0.38, 0.38, 0.36);
const line = rgb(0.86, 0.86, 0.84);
const panel = rgb(0.975, 0.972, 0.96);
const yellow = rgb(0.984, 0.82, 0.173);
const white = rgb(1, 1, 1);
const outstanding = rgb(0.55, 0.32, 0.05);
const resolved = rgb(0.12, 0.4, 0.28);

export type CompletionReportImage = {
  id: string;
  caption: string;
  bytes: Uint8Array;
};

export type CompletionReportPdfInput = {
  reportReference: string;
  versionNumber: number;
  generatedAtLabel: string;
  jobReference: string | null;
  quoteReference: string | null;
  companyName: string;
  siteAddress: string | null;
  scheduledAtLabel: string | null;
  completedAtLabel: string | null;
  installers: string[];
  visitStatusLabel: string;
  visitTitle: string;
  visitNumber: number;
  projectStatusLabel: string;
  workDetails: { label: string; value: string }[];
  checklist: {
    siteLeftSafeAndTidy: boolean;
    installationPhotosRecorded: boolean;
    recordedBy: string | null;
    recordedAtLabel: string | null;
  };
  snags: {
    description: string;
    statusLabel: string;
    outstanding: boolean;
    assignee: string | null;
    resolutionNotes: string | null;
    issuePhotos: CompletionReportImage[];
    resolutionPhotos: CompletionReportImage[];
  }[];
  attendance: "present" | "absent" | "declined" | null;
  customerName: string | null;
  declineReason: string | null;
  signedAtLabel: string | null;
  signOffRecordedBy: string | null;
  signaturePng: Uint8Array | null;
  photos: {
    phaseLabel: string;
    images: CompletionReportImage[];
  }[];
  includeQuotationAppendix?: false;
};

type Fonts = { regular: PDFFont; bold: PDFFont };

type Cursor = {
  page: PDFPage;
  y: number;
};

function wrap(font: PDFFont, text: string, size: number, width: number) {
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

async function embedPhotograph(doc: PDFDocument, image: CompletionReportImage) {
  const source = image.bytes;
  image.bytes = new Uint8Array(0);
  const prepared = await prepareReportPhotograph(source, image.caption);
  const kind = detectReportImageKind(prepared);
  try {
    const embedded = kind === "png" ? await doc.embedPng(prepared) : await doc.embedJpg(prepared);
    return { image: embedded, orientation: 1 };
  } catch {
    throw new Error(unreadableReportPhotographMessage(image.caption));
  }
}

export async function buildInstallationCompletionReportPdf(input: CompletionReportPdfInput) {
  if (input.includeQuotationAppendix) {
    throw new Error("A quotation appendix is not part of the installation completion report.");
  }

  const doc = await PDFDocument.create();
  doc.setTitle(`Installation Completion Report ${input.reportReference}`);
  doc.setAuthor("Candid Creative");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const logo = await embedCandidLogo(doc, 92);
  const pages: PDFPage[] = [];

  const cursor = openPage(doc, pages, fonts, logo);

  drawTitle(cursor, fonts, input.reportReference);
  drawSummary(cursor, fonts, input, () => openPage(doc, pages, fonts, logo));
  drawWork(cursor, fonts, input, () => openPage(doc, pages, fonts, logo));
  drawChecklist(cursor, fonts, input, () => openPage(doc, pages, fonts, logo));
  await drawSignOff(doc, cursor, fonts, input, () => openPage(doc, pages, fonts, logo));
  await drawSnags(doc, cursor, fonts, input, () => openPage(doc, pages, fonts, logo));
  await drawPhotographs(doc, cursor, fonts, input, () => openPage(doc, pages, fonts, logo));

  pages.forEach((page, index) => {
    drawFooter(page, fonts, input.reportReference, index + 1, pages.length);
  });

  return doc.save();
}

function openPage(
  doc: PDFDocument,
  pages: PDFPage[],
  fonts: Fonts,
  logo: { image: PDFImage; width: number; height: number }
): Cursor {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pages.push(page);
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 8, width: PAGE_WIDTH, height: 8, color: yellow });
  page.drawImage(logo.image, {
    x: MARGIN,
    y: PAGE_HEIGHT - 28 - logo.height,
    width: logo.width,
    height: logo.height,
  });
  const label = "INSTALLATION COMPLETION REPORT";
  const labelWidth = fonts.bold.widthOfTextAtSize(label, 8);
  page.drawText(label, {
    x: PAGE_WIDTH - MARGIN - labelWidth,
    y: PAGE_HEIGHT - 42,
    size: 8,
    font: fonts.bold,
    color: ink,
  });
  const dividerY = PAGE_HEIGHT - 36 - logo.height;
  page.drawLine({
    start: { x: MARGIN, y: dividerY },
    end: { x: PAGE_WIDTH - MARGIN, y: dividerY },
    thickness: 0.6,
    color: line,
  });
  return { page, y: dividerY - 22 };
}

function ensure(cursor: Cursor, height: number, nextPage: () => Cursor) {
  if (cursor.y - height < CONTENT_BOTTOM) {
    const fresh = nextPage();
    cursor.page = fresh.page;
    cursor.y = fresh.y;
  }
}

function drawTitle(cursor: Cursor, fonts: Fonts, reference: string) {
  cursor.page.drawText("Installation Completion Report", {
    x: MARGIN,
    y: cursor.y - 22,
    size: 22,
    font: fonts.bold,
    color: ink,
  });
  cursor.y -= 40;
  cursor.page.drawText(sanitizePdfText(reference), {
    x: MARGIN,
    y: cursor.y,
    size: 10,
    font: fonts.regular,
    color: muted,
  });
  cursor.y -= 22;
}

function drawSummary(
  cursor: Cursor,
  fonts: Fonts,
  input: CompletionReportPdfInput,
  nextPage: () => Cursor
) {
  const rows = [
    ["Customer", input.companyName],
    ["Job number", input.jobReference || "Not linked"],
    ["Quote reference", input.quoteReference || "Not linked"],
    ["Site address", input.siteAddress],
    ["Scheduled installation", input.scheduledAtLabel],
    ["Visit completed", input.completedAtLabel],
    ["Customer sign-off", input.signedAtLabel],
    ["Report generated", input.generatedAtLabel],
    ["Installers", input.installers.length > 0 ? input.installers.join(", ") : null],
    ["Visit status", input.visitStatusLabel],
  ].filter((row): row is [string, string] => typeof row[1] === "string" && row[1].trim().length > 0);
  ensure(cursor, 36 + rows.length * 18 + 28, nextPage);
  cursor.page.drawText(sanitizePdfText(`Visit ${input.visitNumber}: ${input.visitTitle}`), {
    x: MARGIN,
    y: cursor.y,
    size: 14,
    font: fonts.bold,
    color: ink,
  });
  cursor.y -= 20;
  for (const [label, value] of rows) {
    const lines = wrap(fonts.regular, value, 10, CONTENT_WIDTH - 156);
    ensure(cursor, lines.length * 13 + 6, nextPage);
    cursor.page.drawText(label, { x: MARGIN, y: cursor.y, size: 9, font: fonts.bold, color: muted });
    lines.forEach((textLine, index) => {
      cursor.page.drawText(textLine, {
        x: MARGIN + 156,
        y: cursor.y - index * 13,
        size: 10,
        font: fonts.regular,
        color: ink,
      });
    });
    cursor.y -= lines.length * 13 + 5;
  }
  cursor.y -= 4;
  const scope = wrap(fonts.regular, installationReportScopeStatement(input.visitNumber, input.projectStatusLabel), 8, CONTENT_WIDTH);
  for (const scopeLine of scope) {
    ensure(cursor, 12, nextPage);
    cursor.page.drawText(scopeLine, { x: MARGIN, y: cursor.y, size: 8, font: fonts.regular, color: muted });
    cursor.y -= 12;
  }
  cursor.y -= 6;
}

function drawWork(
  cursor: Cursor,
  fonts: Fonts,
  input: CompletionReportPdfInput,
  nextPage: () => Cursor
) {
  sectionHeading(cursor, fonts, "Work completed", nextPage, 48);
  if (input.workDetails.length === 0) {
    paragraph(cursor, fonts, "No work description was recorded for this visit.", nextPage);
    return;
  }

  for (const detail of input.workDetails) {
    const lines = wrap(fonts.regular, detail.value, 11, CONTENT_WIDTH);
    const showLabel = detail.label !== "Work completed";
    ensure(cursor, (showLabel ? 16 : 0) + lines.length * 14, nextPage);
    if (showLabel) {
      cursor.page.drawText(sanitizePdfText(detail.label), {
        x: MARGIN,
        y: cursor.y,
        size: 9,
        font: fonts.bold,
        color: muted,
      });
      cursor.y -= 14;
    }
    for (const textLine of lines) {
      ensure(cursor, 14, nextPage);
      cursor.page.drawText(textLine, { x: MARGIN, y: cursor.y, size: 11, font: fonts.regular, color: ink });
      cursor.y -= 14;
    }
    cursor.y -= 6;
  }
}

function drawChecklist(
  cursor: Cursor,
  fonts: Fonts,
  input: CompletionReportPdfInput,
  nextPage: () => Cursor
) {
  sectionHeading(cursor, fonts, "Completion checklist", nextPage, 56);
  const items = [
    [COMPLETION_CHECKLIST[0], input.checklist.siteLeftSafeAndTidy],
    [COMPLETION_CHECKLIST[1], input.checklist.installationPhotosRecorded],
  ] as const;
  for (const [label, confirmed] of items) {
    ensure(cursor, 22, nextPage);
    cursor.page.drawText(confirmed ? "Confirmed" : "Not confirmed", {
      x: MARGIN,
      y: cursor.y,
      size: 9,
      font: fonts.bold,
      color: confirmed ? resolved : outstanding,
    });
    cursor.page.drawText(sanitizePdfText(label), {
      x: MARGIN + 88,
      y: cursor.y,
      size: 10,
      font: fonts.regular,
      color: ink,
    });
    cursor.y -= 18;
  }
  const recordedAt =
    input.checklist.recordedAtLabel && input.checklist.recordedAtLabel !== input.signedAtLabel
      ? input.checklist.recordedAtLabel
      : null;
  const recorded = input.checklist.recordedBy
    ? `Recorded by ${input.checklist.recordedBy}${recordedAt ? ` | ${recordedAt}` : ""}`
    : "No checklist confirmation was recorded.";
  paragraph(cursor, fonts, recorded, nextPage);
}

async function drawSignOff(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  input: CompletionReportPdfInput,
  nextPage: () => Cursor
) {
  sectionHeading(cursor, fonts, "Customer sign-off", nextPage, 48);
  if (input.attendance === "absent") {
    paragraph(cursor, fonts, "Customer not present — no signature obtained.", nextPage);
  } else if (input.attendance === "declined") {
    paragraph(cursor, fonts, "Customer declined to sign.", nextPage);
    if (input.declineReason) {
      paragraph(cursor, fonts, input.declineReason, nextPage);
    }
  } else if (input.attendance === "present") {
    paragraph(cursor, fonts, input.customerName ? `Customer: ${input.customerName}` : "Customer name was not recorded.", nextPage);
    if (input.signaturePng) {
      ensure(cursor, 110, nextPage);
      const image = await doc.embedPng(input.signaturePng).catch(() => {
        throw new Error("The customer signature could not be embedded. It must be a PNG.");
      });
      const maxWidth = 240;
      const maxHeight = 80;
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      cursor.page.drawRectangle({
        x: MARGIN,
        y: cursor.y - height - 8,
        width: width + 16,
        height: height + 8,
        borderColor: line,
        borderWidth: 0.6,
        color: white,
      });
      cursor.page.drawImage(image, {
        x: MARGIN + 8,
        y: cursor.y - height - 4,
        width,
        height,
      });
      cursor.y -= height + 20;
    }
  } else {
    paragraph(cursor, fonts, "No customer sign-off was recorded for this visit.", nextPage);
  }

  if (input.signedAtLabel || input.signOffRecordedBy) {
    const when =
      input.attendance === "present" && input.signedAtLabel
        ? `Signed ${input.signedAtLabel}`
        : input.signedAtLabel
          ? `Recorded ${input.signedAtLabel}`
          : null;
    paragraph(
      cursor,
      fonts,
      [when, input.signOffRecordedBy ? `Recorded by ${input.signOffRecordedBy}` : null].filter(Boolean).join(" | "),
      nextPage
    );
  }
}

async function drawSnags(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  input: CompletionReportPdfInput,
  nextPage: () => Cursor
) {
  const openSnags = input.snags.filter((snag) => snag.outstanding);
  const closedSnags = input.snags.filter((snag) => !snag.outstanding);
  sectionHeading(cursor, fonts, openSnags.length > 0 ? "Outstanding snags" : "Snagging", nextPage, 56);
  paragraph(cursor, fonts, installationReportSnagStatement(openSnags.length, input.snags.length), nextPage);
  for (const snag of openSnags) {
    await drawSnag(doc, cursor, fonts, snag, nextPage);
  }
  if (closedSnags.length > 0) {
    if (openSnags.length > 0) sectionHeading(cursor, fonts, "Resolved snags", nextPage, 56);
    for (const snag of closedSnags) {
      await drawSnag(doc, cursor, fonts, snag, nextPage);
    }
  }
}

async function drawSnag(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  snag: CompletionReportPdfInput["snags"][number],
  nextPage: () => Cursor
) {
  const description = wrap(fonts.regular, snag.description, 11, CONTENT_WIDTH - 16);
  ensure(cursor, 36 + description.length * 14, nextPage);
  cursor.page.drawRectangle({
    x: MARGIN,
    y: cursor.y - 14,
    width: CONTENT_WIDTH,
    height: 22,
    color: snag.outstanding ? rgb(0.99, 0.95, 0.86) : rgb(0.93, 0.96, 0.94),
  });
  cursor.page.drawText(sanitizePdfText(snag.statusLabel), {
    x: MARGIN + 8,
    y: cursor.y - 8,
    size: 9,
    font: fonts.bold,
    color: snag.outstanding ? outstandingColor() : resolved,
  });
  cursor.y -= 28;
  for (const textLine of description) {
    ensure(cursor, 14, nextPage);
    cursor.page.drawText(textLine, { x: MARGIN, y: cursor.y, size: 11, font: fonts.regular, color: ink });
    cursor.y -= 14;
  }
  if (snag.assignee) paragraph(cursor, fonts, `Responsible: ${snag.assignee}`, nextPage);
  if (snag.resolutionNotes) paragraph(cursor, fonts, `Resolution notes: ${snag.resolutionNotes}`, nextPage);
  await drawImageRow(doc, cursor, fonts, "Issue photographs", snag.issuePhotos, nextPage);
  await drawImageRow(doc, cursor, fonts, "Resolution photographs", snag.resolutionPhotos, nextPage);
  cursor.y -= 8;
}

function outstandingColor() {
  return outstanding;
}

async function drawPhotographs(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  input: CompletionReportPdfInput,
  nextPage: () => Cursor
) {
  const groups = input.photos.filter((group) => group.images.length > 0);
  if (groups.length === 0) {
    sectionHeading(cursor, fonts, "Photographic evidence", nextPage);
    paragraph(cursor, fonts, "No installation photographs were selected for this report.", nextPage);
    return;
  }

  const prepared = [];
  for (const [groupIndex, group] of groups.entries()) {
    for (const image of group.images) {
      const embedded = await embedPhotograph(doc, image);
      const visual = orientedPixelSize(embedded.image.width, embedded.image.height, embedded.orientation);
      prepared.push({
        embedded,
        caption: image.caption,
        width: visual.width,
        height: visual.height,
        group: groupIndex,
        phase: group.phaseLabel,
      });
    }
  }
  await drawPreparedPhotographs(cursor, fonts, prepared, nextPage, "Photographic evidence");
}

async function drawPreparedPhotographs(
  cursor: Cursor,
  fonts: Fonts,
  images: {
    embedded: Awaited<ReturnType<typeof embedPhotograph>>;
    caption: string;
    width: number;
    height: number;
    group: number;
    phase: string;
  }[],
  nextPage: () => Cursor,
  section: string | null
) {
  const gap = 14;
  const rows = planPhotographRows(
    images.map((image) => ({ width: image.width, height: image.height, group: image.group })),
    {
      contentWidth: CONTENT_WIDTH,
      firstBudget: Math.max(0, cursor.y - CONTENT_BOTTOM),
      pageBudget: 640,
      sectionHeading: section ? 34 : 0,
      phaseHeading: 24,
    }
  );
  let page = -1;
  for (const row of rows) {
    if (row.page !== page) {
      if (page !== -1 || row.page > 0) {
        const fresh = nextPage();
        cursor.page = fresh.page;
        cursor.y = fresh.y;
      }
      page = row.page;
    }
    if (row.showSection && section) drawSectionHeading(cursor, fonts, section);
    if (row.showPhase) {
      cursor.y -= 4;
      cursor.page.drawText(sanitizePdfText(images[row.indexes[0]].phase), {
        x: MARGIN,
        y: cursor.y,
        size: 12,
        font: fonts.bold,
        color: ink,
      });
      cursor.y -= 18;
    }
    const cellWidth = row.columns === 1 ? CONTENT_WIDTH : (CONTENT_WIDTH - gap) / 2;
    const fitted = row.indexes.map((index) => {
      const image = images[index];
      const scale = Math.min(cellWidth / image.width, row.maxHeight / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      return { image, width, height, captionLines: wrap(fonts.regular, image.caption, 8, cellWidth) };
    });
    const imageHeight = Math.max(...fitted.map((item) => item.height));
    const captionHeight = Math.max(...fitted.map((item) => 18 + item.captionLines.length * 12));
    fitted.forEach((item, column) => {
      const x = MARGIN + column * (cellWidth + gap);
      const y = cursor.y - item.height;
      cursor.page.drawRectangle({
        x,
        y: y - 4,
        width: cellWidth,
        height: item.height + 4,
        color: panel,
      });
      const placement = placeOrientedPhotograph(
        { x: x + (cellWidth - item.width) / 2, y, width: item.width, height: item.height },
        item.image.embedded.orientation
      );
      cursor.page.drawImage(item.image.embedded.image, {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        rotate: degrees(placement.rotate),
      });
      item.captionLines.forEach((caption, captionIndex) => {
        cursor.page.drawText(caption, {
          x,
          y: y - 14 - captionIndex * 10,
          size: 8,
          font: fonts.regular,
          color: muted,
        });
      });
    });
    cursor.y -= imageHeight + captionHeight;
  }
}

async function drawImageRow(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  label: string,
  images: CompletionReportImage[],
  nextPage: () => Cursor
) {
  if (images.length === 0) return;
  const prepared = [];
  for (const image of images) {
    const embedded = await embedPhotograph(doc, image);
    const visual = orientedPixelSize(embedded.image.width, embedded.image.height, embedded.orientation);
    prepared.push({
      embedded,
      caption: image.caption,
      width: visual.width,
      height: visual.height,
      group: 0,
      phase: label,
    });
  }
  await drawPreparedPhotographs(cursor, fonts, prepared, nextPage, null);
}

function sectionHeading(cursor: Cursor, fonts: Fonts, title: string, nextPage: () => Cursor, reserve = 72) {
  ensure(cursor, 30 + reserve, nextPage);
  drawSectionHeading(cursor, fonts, title);
}

function drawSectionHeading(cursor: Cursor, fonts: Fonts, title: string) {
  cursor.y -= 8;
  cursor.page.drawRectangle({ x: MARGIN, y: cursor.y - 2, width: 18, height: 3, color: yellow });
  cursor.page.drawText(title, { x: MARGIN + 24, y: cursor.y - 4, size: 13, font: fonts.bold, color: ink });
  cursor.y -= 22;
}

function paragraph(cursor: Cursor, fonts: Fonts, text: string, nextPage: () => Cursor) {
  const lines = wrap(fonts.regular, text, 10, CONTENT_WIDTH);
  for (const textLine of lines) {
    ensure(cursor, 14, nextPage);
    cursor.page.drawText(textLine, { x: MARGIN, y: cursor.y, size: 10, font: fonts.regular, color: ink });
    cursor.y -= 13;
  }
  cursor.y -= 4;
}

function drawFooter(page: PDFPage, fonts: Fonts, reference: string, pageNumber: number, totalPages: number) {
  page.drawLine({
    start: { x: MARGIN, y: MARGIN + 18 },
    end: { x: PAGE_WIDTH - MARGIN, y: MARGIN + 18 },
    thickness: 0.4,
    color: line,
  });
  page.drawText(sanitizePdfText(`Candid Creative | ${reference} | Visit report`), {
    x: MARGIN,
    y: MARGIN + 6,
    size: 8,
    font: fonts.regular,
    color: muted,
  });
  const paging = `Page ${pageNumber} of ${totalPages}`;
  const width = fonts.bold.widthOfTextAtSize(paging, 8);
  page.drawText(paging, {
    x: PAGE_WIDTH - MARGIN - width,
    y: MARGIN + 6,
    size: 8,
    font: fonts.bold,
    color: ink,
  });
}
