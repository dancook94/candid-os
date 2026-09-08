import type { PDFDocument, PDFImage, PDFPage, PDFFont } from "pdf-lib";
import { rgb } from "pdf-lib";

import {
  computeArtworkPreviewPlacement,
  type ArtworkPreviewPlacement,
} from "@/lib/proof-generator/cut-path-overlay";
import {
  PROOF_PDF_LOGO_DISPLAY_WIDTH,
  PROOF_PDF_MARGIN,
  PROOF_PDF_PAGE_HEIGHT,
  PROOF_PDF_PAGE_WIDTH,
  loadCandidLogoPng,
} from "@/lib/proof-generator/pdf-brand";
import type { PreflightCheck } from "@/lib/proof-generator/types";
import {
  formatProofFieldValue,
  sanitizePdfText,
  statusPrefixForCheck,
} from "@/lib/proof-generator/pdf-text";

export const PROOF_PDF_THEME = {
  yellow: rgb(0.984, 0.82, 0.173),
  text: rgb(0.118, 0.118, 0.11),
  muted: rgb(0.45, 0.45, 0.45),
  border: rgb(0.86, 0.86, 0.86),
  panel: rgb(0.97, 0.97, 0.97),
  footer: rgb(0.14, 0.14, 0.13),
  footerText: rgb(0.95, 0.95, 0.95),
  white: rgb(1, 1, 1),
  pass: rgb(0.16, 0.52, 0.36),
  passBg: rgb(0.93, 0.98, 0.95),
  review: rgb(0.42, 0.42, 0.42),
  reviewBg: rgb(0.96, 0.96, 0.96),
  warning: rgb(0.78, 0.52, 0.08),
  warningBg: rgb(0.99, 0.97, 0.9),
  fail: rgb(0.72, 0.18, 0.18),
  failBg: rgb(0.99, 0.94, 0.94),
} as const;

export type ProofPdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
};

type DrawTextOptions = Parameters<PDFPage["drawText"]>[1];

function drawText(page: PDFPage, text: string, options: DrawTextOptions) {
  page.drawText(sanitizePdfText(text), options);
}

function contentWidth() {
  return PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN * 2;
}

function statusColors(status: PreflightCheck["status"]) {
  switch (status) {
    case "pass":
      return { accent: PROOF_PDF_THEME.pass, background: PROOF_PDF_THEME.passBg };
    case "warning":
      return { accent: PROOF_PDF_THEME.warning, background: PROOF_PDF_THEME.warningBg };
    case "manual_review":
      return { accent: PROOF_PDF_THEME.review, background: PROOF_PDF_THEME.reviewBg };
    case "fail":
      return { accent: PROOF_PDF_THEME.fail, background: PROOF_PDF_THEME.failBg };
    default:
      return { accent: PROOF_PDF_THEME.review, background: PROOF_PDF_THEME.reviewBg };
  }
}

const HEADER_DOC_LABEL_SIZE = 8;
const HEADER_PAGE_INDICATOR_SIZE = 9;
const HEADER_DIVIDER_GAP = 10;
const HEADER_CONTENT_GAP = 16;
const HERO_DIVIDER_CLEAR_GAP = 14;
const HERO_META_GAP = 20;
const HERO_TITLE_MIN_SIZE = 34;
const HERO_TITLE_MAX_SIZE = 40;
const HERO_TITLE_WORD_GAP = 10;
const HERO_CAP_ASCENDER_RATIO = 0.72;
const HERO_CAP_DESCENDER_RATIO = 0.22;

function resolveHeroTitleFontSize(fonts: ProofPdfFonts, maxWidth: number) {
  const proofForText = sanitizePdfText("PROOF FOR");
  const approvalText = sanitizePdfText("APPROVAL");

  for (let size = HERO_TITLE_MAX_SIZE; size >= HERO_TITLE_MIN_SIZE; size -= 1) {
    const totalWidth =
      fonts.bold.widthOfTextAtSize(proofForText, size) +
      HERO_TITLE_WORD_GAP +
      fonts.bold.widthOfTextAtSize(approvalText, size);

    if (totalWidth <= maxWidth) {
      return size;
    }
  }

  return HERO_TITLE_MIN_SIZE;
}

export async function embedCandidLogo(
  doc: PDFDocument,
  displayWidth = PROOF_PDF_LOGO_DISPLAY_WIDTH
) {
  const pngBuffer = await loadCandidLogoPng();
  const image = await doc.embedPng(pngBuffer);
  const aspect = image.width / image.height;
  const width = displayWidth;
  const height = width / aspect;
  return { image, width, height, rasterWidth: image.width };
}

export function drawProofPageHeader(
  page: PDFPage,
  fonts: ProofPdfFonts,
  logo: { image: PDFImage; width: number; height: number },
  pageNumber: number,
  totalPages: number,
  options?: { showPageIndicator?: boolean }
) {
  const showPageIndicator = options?.showPageIndicator ?? true;
  const top = PROOF_PDF_PAGE_HEIGHT - PROOF_PDF_MARGIN;
  const rightEdge = PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN;

  page.drawImage(logo.image, {
    x: PROOF_PDF_MARGIN,
    y: top - logo.height,
    width: logo.width,
    height: logo.height,
  });

  const docLabel = sanitizePdfText("PROOF FOR APPROVAL");
  const docLabelWidth = fonts.bold.widthOfTextAtSize(docLabel, HEADER_DOC_LABEL_SIZE);
  drawText(page, docLabel, {
    x: rightEdge - docLabelWidth,
    y: top - 14,
    size: HEADER_DOC_LABEL_SIZE,
    font: fonts.bold,
    color: PROOF_PDF_THEME.text,
  });

  if (showPageIndicator) {
    const indicator = `${String(pageNumber).padStart(2, "0")} / ${String(totalPages).padStart(2, "0")}`;
    const indicatorWidth = fonts.bold.widthOfTextAtSize(indicator, HEADER_PAGE_INDICATOR_SIZE);
    drawText(page, indicator, {
      x: rightEdge - indicatorWidth,
      y: top - 28,
      size: HEADER_PAGE_INDICATOR_SIZE,
      font: fonts.bold,
      color: PROOF_PDF_THEME.yellow,
    });
  }

  const logoBottom = top - logo.height;
  const rightBlockBottom = showPageIndicator
    ? top - 28 - HEADER_PAGE_INDICATOR_SIZE
    : top - 14 - HEADER_DOC_LABEL_SIZE;
  const headerBottom = Math.min(logoBottom, rightBlockBottom);
  const dividerY = headerBottom - HEADER_DIVIDER_GAP;

  page.drawLine({
    start: { x: PROOF_PDF_MARGIN, y: dividerY },
    end: { x: PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN, y: dividerY },
    thickness: 0.75,
    color: PROOF_PDF_THEME.border,
  });

  return {
    dividerY,
    contentStartY: dividerY - HEADER_CONTENT_GAP,
  };
}

export function drawProofHeroTitle(
  page: PDFPage,
  fonts: ProofPdfFonts,
  dividerY: number
) {
  const fontSize = resolveHeroTitleFontSize(fonts, contentWidth());
  const proofForText = sanitizePdfText("PROOF FOR");
  const approvalText = sanitizePdfText("APPROVAL");
  const proofForWidth = fonts.bold.widthOfTextAtSize(proofForText, fontSize);
  const baselineY =
    dividerY - HERO_DIVIDER_CLEAR_GAP - fontSize * HERO_CAP_ASCENDER_RATIO;

  drawText(page, proofForText, {
    x: PROOF_PDF_MARGIN,
    y: baselineY,
    size: fontSize,
    font: fonts.bold,
    color: PROOF_PDF_THEME.text,
  });

  drawText(page, approvalText, {
    x: PROOF_PDF_MARGIN + proofForWidth + HERO_TITLE_WORD_GAP,
    y: baselineY,
    size: fontSize,
    font: fonts.bold,
    color: PROOF_PDF_THEME.yellow,
  });

  return baselineY - fontSize * HERO_CAP_DESCENDER_RATIO - HERO_META_GAP;
}

export function drawProofVersionSubtitle(
  page: PDFPage,
  fonts: ProofPdfFonts,
  y: number,
  versionNumber: number
) {
  drawText(page, "PROOF", {
    x: PROOF_PDF_MARGIN,
    y,
    size: 10,
    font: fonts.bold,
    color: PROOF_PDF_THEME.muted,
  });

  drawText(page, `Version ${versionNumber}`, {
    x: PROOF_PDF_MARGIN + 42,
    y,
    size: 14,
    font: fonts.bold,
    color: PROOF_PDF_THEME.text,
  });

  return y - 22;
}

export function drawMetaField(
  page: PDFPage,
  fonts: ProofPdfFonts,
  {
    label,
    value,
    x,
    y,
    width,
  }: {
    label: string;
    value: string;
    x: number;
    y: number;
    width: number;
  }
) {
  drawText(page, label.toUpperCase(), {
    x,
    y,
    size: 7,
    font: fonts.bold,
    color: PROOF_PDF_THEME.muted,
  });

  drawText(page, value, {
    x,
    y: y - 11,
    size: 10,
    font: fonts.regular,
    color: PROOF_PDF_THEME.text,
    maxWidth: width,
    lineHeight: 11,
  });

  return y - 26;
}

export function drawMetaGrid(
  page: PDFPage,
  fonts: ProofPdfFonts,
  y: number,
  rows: Array<{ label: string; value: string }>
) {
  const columnWidth = (contentWidth() - 12) / 2;
  let leftY = y;
  let rightY = y;

  rows.forEach((row, index) => {
    const column = index % 2;
    const x = column === 0 ? PROOF_PDF_MARGIN : PROOF_PDF_MARGIN + columnWidth + 12;
    const nextY = drawMetaField(page, fonts, {
      label: row.label,
      value: row.value,
      x,
      y: column === 0 ? leftY : rightY,
      width: columnWidth,
    });

    if (column === 0) {
      leftY = nextY;
    } else {
      rightY = nextY;
    }
  });

  return Math.min(leftY, rightY) - 6;
}

export function drawArtworkPreviewFrame(
  page: PDFPage,
  {
    x,
    y,
    width,
    height,
    preview,
  }: {
    x: number;
    y: number;
    width: number;
    height: number;
    preview:
      | { kind: "image"; image: PDFImage; imageWidth: number; imageHeight: number }
      | { kind: "page"; page: Parameters<PDFPage["drawPage"]>[0]; pageWidth: number; pageHeight: number };
  }
): ArtworkPreviewPlacement {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: PROOF_PDF_THEME.white,
    borderColor: PROOF_PDF_THEME.border,
    borderWidth: 0.75,
  });

  const placement = computeArtworkPreviewPlacement({
    frameX: x,
    frameY: y,
    frameWidth: width,
    frameHeight: height,
    sourceWidthPt:
      preview.kind === "image" ? preview.imageWidth : preview.pageWidth,
    sourceHeightPt:
      preview.kind === "image" ? preview.imageHeight : preview.pageHeight,
  });

  if (preview.kind === "image") {
    page.drawImage(preview.image, {
      x: placement.drawX,
      y: placement.drawY,
      width: placement.drawWidth,
      height: placement.drawHeight,
    });
    return placement;
  }

  page.drawPage(preview.page, {
    x: placement.drawX,
    y: placement.drawY,
    width: placement.drawWidth,
    height: placement.drawHeight,
  });

  return placement;
}

export function estimateWrappedLineCount(
  text: string,
  maxWidth: number,
  font: PDFFont,
  fontSize: number
) {
  const sanitized = sanitizePdfText(text);
  const words = sanitized.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return 0;
  }

  let lines = 1;
  let currentWidth = 0;

  for (const word of words) {
    const wordWidth = font.widthOfTextAtSize(`${word} `, fontSize);
    if (currentWidth + wordWidth > maxWidth && currentWidth > 0) {
      lines += 1;
      currentWidth = wordWidth;
    } else {
      currentWidth += wordWidth;
    }
  }

  return lines;
}

export function drawCustomerMessagePanel(
  page: PDFPage,
  fonts: ProofPdfFonts,
  {
    message,
    x,
    y,
    width,
  }: {
    message: string;
    x: number;
    y: number;
    width: number;
  }
) {
  const lineCount = estimateWrappedLineCount(message, width - 24, fonts.regular, 10);
  const panelHeight = 32 + lineCount * 12;

  page.drawRectangle({
    x,
    y: y - panelHeight,
    width,
    height: panelHeight,
    color: PROOF_PDF_THEME.panel,
    borderColor: PROOF_PDF_THEME.border,
    borderWidth: 0.75,
  });

  page.drawRectangle({
    x,
    y: y - panelHeight,
    width: 3,
    height: panelHeight,
    color: PROOF_PDF_THEME.yellow,
  });

  drawText(page, "CUSTOMER MESSAGE", {
    x: x + 14,
    y: y - 15,
    size: 8,
    font: fonts.bold,
    color: PROOF_PDF_THEME.muted,
  });

  drawText(page, message, {
    x: x + 14,
    y: y - 28,
    size: 10,
    font: fonts.regular,
    color: PROOF_PDF_THEME.text,
    maxWidth: width - 24,
    lineHeight: 12,
  });

  return y - panelHeight - 8;
}

export function drawApprovalFooterBar(
  page: PDFPage,
  fonts: ProofPdfFonts,
  text: string,
  secondaryText?: string
) {
  const barHeight = 34;
  const y = PROOF_PDF_MARGIN;

  page.drawRectangle({
    x: 0,
    y,
    width: PROOF_PDF_PAGE_WIDTH,
    height: barHeight,
    color: PROOF_PDF_THEME.footer,
  });

  page.drawRectangle({
    x: 0,
    y: y + barHeight - 2,
    width: PROOF_PDF_PAGE_WIDTH,
    height: 2,
    color: PROOF_PDF_THEME.yellow,
  });

  drawText(page, text, {
    x: PROOF_PDF_MARGIN,
    y: y + 12,
    size: 9,
    font: fonts.regular,
    color: PROOF_PDF_THEME.footerText,
  });

  if (secondaryText) {
    drawText(page, secondaryText, {
      x: PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN - fonts.regular.widthOfTextAtSize(secondaryText, 8),
      y: y + 12,
      size: 8,
      font: fonts.regular,
      color: PROOF_PDF_THEME.footerText,
    });
  }

  return y + barHeight + 10;
}

function estimateSpecificationRowsHeight(
  rows: Array<{ label: string; value: string }>,
  width: number,
  fonts: ProofPdfFonts
) {
  let height = 0;

  for (const row of rows) {
    const valueLines = estimateWrappedLineCount(row.value, width - 108, fonts.regular, 9);
    height += Math.max(13, valueLines * 11 + 1);
  }

  return height;
}

export function estimateSpecificationSectionCardHeight(
  rows: Array<{ label: string; value: string }>,
  width: number,
  fonts: ProofPdfFonts
) {
  const padding = 12;
  const titleBlock = 22;
  const rowsHeight = estimateSpecificationRowsHeight(rows, width - padding * 2, fonts);
  return padding + titleBlock + rowsHeight + padding + 12;
}

function estimatePreflightChecksHeight(
  checks: PreflightCheck[],
  width: number,
  fonts: ProofPdfFonts
) {
  let checksHeight = 0;

  for (const check of checks) {
    const messageLines = estimateWrappedLineCount(check.message, width - 24, fonts.regular, 8);
    checksHeight += 34 + messageLines * 10 + 8;
  }

  return checksHeight;
}

export function estimatePreflightSectionCardHeight(
  checks: PreflightCheck[],
  width: number,
  fonts: ProofPdfFonts
) {
  const padding = 12;
  const checksHeight = estimatePreflightChecksHeight(checks, width - padding * 2, fonts);
  return padding + 22 + checksHeight + padding + 12;
}

export function drawSpecificationSectionCard(
  page: PDFPage,
  fonts: ProofPdfFonts,
  {
    title,
    x,
    y,
    width,
    rows,
  }: {
    title: string;
    x: number;
    y: number;
    width: number;
    rows: Array<{ label: string; value: string }>;
  }
) {
  const padding = 12;
  const titleBlock = 22;
  const rowsHeight = estimateSpecificationRowsHeight(rows, width - padding * 2, fonts);
  const cardHeight = padding + titleBlock + rowsHeight + padding;

  page.drawRectangle({
    x,
    y: y - cardHeight,
    width,
    height: cardHeight,
    color: PROOF_PDF_THEME.panel,
    borderColor: PROOF_PDF_THEME.border,
    borderWidth: 0.75,
  });

  page.drawRectangle({
    x,
    y: y - 2,
    width,
    height: 2,
    color: PROOF_PDF_THEME.yellow,
  });

  drawText(page, title.toUpperCase(), {
    x: x + padding,
    y: y - padding - 10,
    size: 9,
    font: fonts.bold,
    color: PROOF_PDF_THEME.text,
  });

  let rowY = y - padding - titleBlock;

  for (const row of rows) {
    drawText(page, row.label, {
      x: x + padding,
      y: rowY,
      size: 8,
      font: fonts.regular,
      color: PROOF_PDF_THEME.muted,
    });

    const valueLines = estimateWrappedLineCount(
      row.value,
      width - padding * 2 - 96,
      fonts.regular,
      9
    );
    drawText(page, row.value, {
      x: x + padding + 96,
      y: rowY,
      size: 9,
      font: fonts.bold,
      color: PROOF_PDF_THEME.text,
      maxWidth: width - padding * 2 - 96,
      lineHeight: 11,
    });

    rowY -= Math.max(13, valueLines * 11 + 1);
  }

  return y - cardHeight - 12;
}

export function drawPreflightSectionCard(
  page: PDFPage,
  fonts: ProofPdfFonts,
  {
    title,
    x,
    y,
    width,
    checks,
  }: {
    title: string;
    x: number;
    y: number;
    width: number;
    checks: PreflightCheck[];
  }
) {
  const padding = 12;
  let checksHeight = 0;

  for (const check of checks) {
    const messageLines = estimateWrappedLineCount(check.message, width - padding * 2 - 24, fonts.regular, 8);
    checksHeight += 34 + messageLines * 10 + 8;
  }

  const cardHeight = padding + 22 + checksHeight + padding;

  page.drawRectangle({
    x,
    y: y - cardHeight,
    width,
    height: cardHeight,
    color: PROOF_PDF_THEME.panel,
    borderColor: PROOF_PDF_THEME.border,
    borderWidth: 0.75,
  });

  page.drawRectangle({
    x,
    y: y - 2,
    width,
    height: 2,
    color: PROOF_PDF_THEME.yellow,
  });

  drawText(page, title.toUpperCase(), {
    x: x + padding,
    y: y - padding - 10,
    size: 9,
    font: fonts.bold,
    color: PROOF_PDF_THEME.text,
  });

  let cardY = y - padding - 22;

  for (const check of checks) {
    cardY = drawPreflightStatusCard(page, fonts, check, x + padding, cardY, width - padding * 2);
  }

  return y - cardHeight - 12;
}

export function drawPreflightStatusCard(
  page: PDFPage,
  fonts: ProofPdfFonts,
  check: PreflightCheck,
  x: number,
  y: number,
  width: number
) {
  const colors = statusColors(check.status);
  const label = statusPrefixForCheck(check.status);
  const message = sanitizePdfText(check.message);
  const messageLines = estimateWrappedLineCount(message, width - 24, fonts.regular, 8);
  const cardHeight = 34 + messageLines * 10;

  page.drawRectangle({
    x,
    y: y - cardHeight,
    width,
    height: cardHeight,
    color: colors.background,
    borderColor: PROOF_PDF_THEME.border,
    borderWidth: 0.5,
  });

  page.drawRectangle({
    x,
    y: y - cardHeight,
    width: 4,
    height: cardHeight,
    color: colors.accent,
  });

  page.drawCircle({
    x: x + 14,
    y: y - 14,
    size: 3.5,
    color: colors.accent,
  });

  drawText(page, label, {
    x: x + 24,
    y: y - 13,
    size: 7,
    font: fonts.bold,
    color: colors.accent,
  });

  drawText(page, check.label, {
    x: x + 24,
    y: y - 24,
    size: 9,
    font: fonts.bold,
    color: PROOF_PDF_THEME.text,
  });

  drawText(page, message, {
    x: x + 24,
    y: y - 36,
    size: 8,
    font: fonts.regular,
    color: PROOF_PDF_THEME.muted,
    maxWidth: width - 28,
    lineHeight: 10,
  });

  return y - cardHeight - 8;
}

export function drawApprovalDisclaimer(
  page: PDFPage,
  fonts: ProofPdfFonts,
  text: string,
  x: number,
  y: number,
  width: number
) {
  drawText(page, text, {
    x,
    y,
    size: 8.5,
    font: fonts.regular,
    color: PROOF_PDF_THEME.text,
    maxWidth: width,
    lineHeight: 12,
  });
}

export function formatProofValue(value: string | null | undefined) {
  return formatProofFieldValue(value);
}
