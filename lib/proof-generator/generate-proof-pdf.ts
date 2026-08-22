import { PDFDocument, StandardFonts, rgb, type PDFEmbeddedPage, type PDFImage, type PDFPage } from "pdf-lib";
import sharp from "sharp";

import type { PreflightResult } from "@/lib/proof-generator/types";
import {
  PDF_MISSING_VALUE,
  formatPdfDimensionsFromBox,
  formatPdfDimensionsLabel,
  formatPreflightCheckLine,
  joinPdfParts,
  sanitizePdfText,
} from "@/lib/proof-generator/pdf-text";

const CANDID_YELLOW = rgb(0.984, 0.82, 0.173);
const TEXT = rgb(0.12, 0.12, 0.12);
const MUTED = rgb(0.35, 0.35, 0.35);
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 45;

function contentWidth() {
  return PAGE_WIDTH - MARGIN * 2;
}

type DrawTextOptions = Parameters<PDFPage["drawText"]>[1];

function drawPdfText(page: PDFPage, text: string, options: DrawTextOptions) {
  page.drawText(sanitizePdfText(text), options);
}

type ArtworkPreview =
  | { kind: "image"; image: PDFImage }
  | { kind: "page"; page: PDFEmbeddedPage; width: number; height: number };

async function embedArtworkPreview(
  targetDoc: PDFDocument,
  sourceBuffer: Buffer,
  inputType: "pdf" | "image"
): Promise<ArtworkPreview | null> {
  if (inputType === "pdf") {
    try {
      const [embeddedPage] = await targetDoc.embedPdf(sourceBuffer, [0]);
      if (!embeddedPage) {
        return null;
      }

      return {
        kind: "page",
        page: embeddedPage,
        width: embeddedPage.width,
        height: embeddedPage.height,
      };
    } catch {
      return null;
    }
  }

  try {
    const pngBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: "inside" })
      .png()
      .toBuffer();

    const image = await targetDoc.embedPng(pngBuffer);
    return { kind: "image", image };
  } catch {
    return null;
  }
}

export async function generateCustomerProofPdf(input: {
  jobReference: string;
  projectName: string;
  proofReference: string;
  versionNumber: number;
  customerMessage?: string | null;
  preflight: PreflightResult;
  sourceBuffer: Buffer;
}) {
  try {
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const primaryItem = input.preflight.quotedItems[0] ?? null;
    const page1 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    page1.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 70,
      width: PAGE_WIDTH,
      height: 70,
      color: CANDID_YELLOW,
    });

    drawPdfText(page1, "Candid Creative", {
      x: MARGIN,
      y: PAGE_HEIGHT - 45,
      size: 18,
      font: bold,
      color: TEXT,
    });

    y -= 90;
    drawPdfText(page1, "PROOF FOR APPROVAL", {
      x: MARGIN,
      y,
      size: 20,
      font: bold,
      color: TEXT,
    });

    y -= 28;
    const metaLines = [
      `Job: ${input.jobReference}`,
      `Project: ${input.projectName}`,
      `Proof: Version ${input.versionNumber}`,
      primaryItem
        ? `Related item: ${joinPdfParts([
            primaryItem.itemReference ?? PDF_MISSING_VALUE,
            primaryItem.itemName,
          ])}`
        : null,
    ].filter(Boolean) as string[];

    for (const line of metaLines) {
      drawPdfText(page1, line, { x: MARGIN, y, size: 11, font: regular, color: TEXT });
      y -= 16;
    }

    const preview = await embedArtworkPreview(
      doc,
      input.sourceBuffer,
      input.preflight.metadata.inputType
    );

    const previewTop = y - 12;
    const previewHeight = 320;
    const previewWidth = contentWidth();

    if (preview?.kind === "image") {
      const scale = Math.min(
        previewWidth / preview.image.width,
        previewHeight / preview.image.height
      );
      const width = preview.image.width * scale;
      const height = preview.image.height * scale;
      page1.drawImage(preview.image, {
        x: MARGIN + (previewWidth - width) / 2,
        y: previewTop - height,
        width,
        height,
      });
    } else if (preview?.kind === "page") {
      const scale = Math.min(
        previewWidth / preview.width,
        previewHeight / preview.height
      );
      page1.drawPage(preview.page, {
        x: MARGIN + (previewWidth - preview.width * scale) / 2,
        y: previewTop - preview.height * scale,
        width: preview.width * scale,
        height: preview.height * scale,
      });
    } else {
      drawPdfText(page1, "Artwork preview unavailable - refer to attached proof file.", {
        x: MARGIN,
        y: previewTop - 40,
        size: 10,
        font: regular,
        color: MUTED,
      });
    }

    if (input.customerMessage?.trim()) {
      drawPdfText(page1, "Customer message", {
        x: MARGIN,
        y: 120,
        size: 11,
        font: bold,
        color: TEXT,
      });
      drawPdfText(page1, input.customerMessage.trim(), {
        x: MARGIN,
        y: 102,
        size: 10,
        font: regular,
        color: TEXT,
        maxWidth: contentWidth(),
        lineHeight: 12,
      });
    }

    drawPdfText(page1, "Please review this proof carefully before approval.", {
      x: MARGIN,
      y: 45,
      size: 9,
      font: regular,
      color: MUTED,
    });

    const page2 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;

    drawPdfText(page2, "PRODUCTION SPECIFICATION", {
      x: MARGIN,
      y,
      size: 16,
      font: bold,
      color: TEXT,
    });

    y -= 24;
    const quotedLines = [
      [
        "Finished size",
        primaryItem?.quotedWidthMm != null && primaryItem?.quotedHeightMm != null
          ? formatPdfDimensionsLabel(primaryItem.quotedWidthMm, primaryItem.quotedHeightMm)
          : PDF_MISSING_VALUE,
      ],
      ["Quantity", primaryItem?.quantity != null ? String(primaryItem.quantity) : PDF_MISSING_VALUE],
      ["Material", primaryItem?.material ?? PDF_MISSING_VALUE],
      ["Print specification", primaryItem?.printSpecification ?? PDF_MISSING_VALUE],
      [
        "Sides / finishing",
        joinPdfParts([primaryItem?.sides, primaryItem?.finishing]),
      ],
    ] as const;

    drawPdfText(page2, "Quoted", { x: MARGIN, y, size: 12, font: bold, color: TEXT });
    y -= 18;

    for (const [label, value] of quotedLines) {
      drawPdfText(page2, `${label}: ${value}`, {
        x: MARGIN,
        y,
        size: 10,
        font: regular,
        color: TEXT,
      });
      y -= 14;
    }

    y -= 10;
    drawPdfText(page2, "Artwork supplied", { x: MARGIN, y, size: 12, font: bold, color: TEXT });
    y -= 18;

    const pageSize = input.preflight.metadata.pageSize.value;
    const suppliedLines = [
      ["Detected size", formatPdfDimensionsFromBox(pageSize)],
      ["Scale", input.preflight.sizeComparison?.matchedScaleLabel ?? PDF_MISSING_VALUE],
      [
        "Page count",
        input.preflight.metadata.pageCount != null
          ? String(input.preflight.metadata.pageCount)
          : PDF_MISSING_VALUE,
      ],
      ["Colour mode", input.preflight.metadata.colourMode.value ?? "Unknown"],
      [
        "Effective resolution",
        input.preflight.checks.find((check) => check.key === "effective_resolution")
          ?.detectedValue ?? PDF_MISSING_VALUE,
      ],
      [
        "Bleed metadata",
        input.preflight.checks.find((check) => check.key === "bleed_box")?.message ??
          PDF_MISSING_VALUE,
      ],
      [
        "Spot colours",
        input.preflight.metadata.spotColourNames.value.join(", ") || PDF_MISSING_VALUE,
      ],
    ] as const;

    for (const [label, value] of suppliedLines) {
      drawPdfText(page2, `${label}: ${value}`, {
        x: MARGIN,
        y,
        size: 10,
        font: regular,
        color: TEXT,
        maxWidth: contentWidth(),
      });
      y -= 14;
    }

    y -= 10;
    drawPdfText(page2, "AUTOMATED PREFLIGHT", { x: MARGIN, y, size: 12, font: bold, color: TEXT });
    y -= 18;

    for (const check of input.preflight.checks.filter((item) => item.status !== "info").slice(0, 8)) {
      drawPdfText(
        page2,
        formatPreflightCheckLine({
          status: check.status,
          label: check.label,
          message: check.message,
        }),
        {
          x: MARGIN,
          y,
          size: 9,
          font: regular,
          color: TEXT,
          maxWidth: contentWidth(),
          lineHeight: 11,
        }
      );
      y -= 22;
    }

    y -= 6;
    drawPdfText(
      page2,
      "Please check all wording, spelling, positioning, dimensions and visual content carefully.\n\nApproval confirms that the artwork shown in this proof is authorised to proceed to production.\n\nColour shown on screen may vary from the final printed result.",
      {
        x: MARGIN,
        y,
        size: 9,
        font: regular,
        color: MUTED,
        maxWidth: contentWidth(),
        lineHeight: 12,
      }
    );

    const bytes = await doc.save();
    return Buffer.from(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown PDF generation error.";
    throw new Error(`Branded proof PDF generation failed: ${detail}`);
  }
}

export function buildGeneratedProofFileName(
  proofReference: string,
  versionNumber: number
) {
  return `${proofReference} Proof v${versionNumber}.pdf`;
}
