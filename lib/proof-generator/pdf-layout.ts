import type { PDFDocument, PDFImage, PDFPage, PDFFont } from "pdf-lib";
import { rgb } from "pdf-lib";

import {
  PROOF_PDF_LOGO_DISPLAY_WIDTH,
  PROOF_PDF_LOGO_RASTER_SCALE,
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
    default:
      return { accent: PROOF_PDF_THEME.review, background: PROOF_PDF_THEME.reviewBg };
  }
}

export async function embedCandidLogo(
  doc: PDFDocument,
  displayWidth = PROOF_PDF_LOGO_DISPLAY_WIDTH
) {
  const rasterWidth = Math.round(displayWidth * PROOF_PDF_LOGO_RASTER_SCALE);
  const pngBuffer = await loadCandidLogoPng(rasterWidth);
  const image = await doc.embedPng(pngBuffer);
  const aspect = image.width / image.height;
  const width = displayWidth;
  const height = width / aspect;
  return { image, width, height, rasterWidth };
}

export function drawProofPageHeader(
  page: PDFPage,
  fonts: ProofPdfFonts,
  logo: { image: PDFImage; width: number; height: number },
  pageNumber: number,
  totalPages: number
) {
  const top = PROOF_PDF_PAGE_HEIGHT - PROOF_PDF_MARGIN;

  page.drawImage(logo.image, {
    x: PROOF_PDF_MARGIN,
    y: top - logo.height,
    width: logo.width,
    height: logo.height,
  });

  drawText(page, "PROOF FOR APPROVAL", {
    x: PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN - 108,
    y: top - 14,
    size: 8,
    font: fonts.bold,
    color: PROOF_PDF_THEME.text,
  });

  const indicator = `${String(pageNumber).padStart(2, "0")} / ${String(totalPages).padStart(2, "0")}`;
  drawText(page, indicator, {
    x: PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN - 34,
    y: top - 28,
    size: 9,
    font: fonts.bold,
    color: PROOF_PDF_THEME.yellow,
  });

  const dividerY = top - logo.height - 8;
  page.drawLine({
    start: { x: PROOF_PDF_MARGIN, y: dividerY },
    end: { x: PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN, y: dividerY },
    thickness: 0.75,
    color: PROOF_PDF_THEME.border,
  });

  return dividerY - 14;
}

export function drawProofHeroTitle(page: PDFPage, fonts: ProofPdfFonts, y: number) {
  const proofForText = sanitizePdfText("PROOF FOR");
  const approvalText = sanitizePdfText("APPROVAL");
  const proofForWidth = fonts.bold.widthOfTextAtSize(proofForText, 26);

  drawText(page, proofForText, {
    x: PROOF_PDF_MARGIN,
    y,
    size: 26,
    font: fonts.bold,
    color: PROOF_PDF_THEME.text,
  });

  drawText(page, approvalText, {
    x: PROOF_PDF_MARGIN + proofForWidth + 8,
    y,
    size: 26,
    font: fonts.bold,
    color: PROOF_PDF_THEME.yellow,
  });

  return y - 28;
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
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: PROOF_PDF_THEME.white,
    borderColor: PROOF_PDF_THEME.border,
    borderWidth: 0.75,
  });

  const padding = 8;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  if (preview.kind === "image") {
    const scale = Math.min(
      innerWidth / preview.imageWidth,
      innerHeight / preview.imageHeight
    );
    const drawWidth = preview.imageWidth * scale;
    const drawHeight = preview.imageHeight * scale;
    page.drawImage(preview.image, {
      x: x + padding + (innerWidth - drawWidth) / 2,
      y: y + padding + (innerHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
    return;
  }

  const scale = Math.min(innerWidth / preview.pageWidth, innerHeight / preview.pageHeight);
  const drawWidth = preview.pageWidth * scale;
  const drawHeight = preview.pageHeight * scale;
  page.drawPage(preview.page, {
    x: x + padding + (innerWidth - drawWidth) / 2,
    y: y + padding + (innerHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  });
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
