import { PDFDocument, StandardFonts, rgb, type PDFEmbeddedPage, type PDFImage } from "pdf-lib";
import sharp from "sharp";

import { formatDimensionsLabel } from "@/lib/proof-generator/analyse-pdf";
import type { PreflightResult } from "@/lib/proof-generator/types";

const CANDID_YELLOW = rgb(0.984, 0.82, 0.173);
const TEXT = rgb(0.12, 0.12, 0.12);
const MUTED = rgb(0.35, 0.35, 0.35);
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 45;

function contentWidth() {
  return PAGE_WIDTH - MARGIN * 2;
}

function statusSymbol(status: string) {
  switch (status) {
    case "pass":
      return "✓";
    case "warning":
      return "⚠";
    case "manual_review":
      return "!";
    default:
      return "•";
  }
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

  page1.drawText("Candid Creative", {
    x: MARGIN,
    y: PAGE_HEIGHT - 45,
    size: 18,
    font: bold,
    color: TEXT,
  });

  y -= 90;
  page1.drawText("PROOF FOR APPROVAL", {
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
      ? `Related item: ${primaryItem.itemReference ?? "—"} · ${primaryItem.itemName}`
      : null,
  ].filter(Boolean) as string[];

  for (const line of metaLines) {
    page1.drawText(line, { x: MARGIN, y, size: 11, font: regular, color: TEXT });
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
    page1.drawText("Artwork preview unavailable — refer to attached proof file.", {
      x: MARGIN,
      y: previewTop - 40,
      size: 10,
      font: regular,
      color: MUTED,
    });
  }

  if (input.customerMessage?.trim()) {
    page1.drawText("Customer message", {
      x: MARGIN,
      y: 120,
      size: 11,
      font: bold,
      color: TEXT,
    });
    page1.drawText(input.customerMessage.trim(), {
      x: MARGIN,
      y: 102,
      size: 10,
      font: regular,
      color: TEXT,
      maxWidth: contentWidth(),
      lineHeight: 12,
    });
  }

  page1.drawText("Please review this proof carefully before approval.", {
    x: MARGIN,
    y: 45,
    size: 9,
    font: regular,
    color: MUTED,
  });

  const page2 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  y = PAGE_HEIGHT - MARGIN;

  page2.drawText("PRODUCTION SPECIFICATION", {
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
        ? `${primaryItem.quotedWidthMm} × ${primaryItem.quotedHeightMm} mm`
        : "—",
    ],
    ["Quantity", primaryItem?.quantity != null ? String(primaryItem.quantity) : "—"],
    ["Material", primaryItem?.material ?? "—"],
    ["Print specification", primaryItem?.printSpecification ?? "—"],
    [
      "Sides / finishing",
      [primaryItem?.sides, primaryItem?.finishing].filter(Boolean).join(" · ") || "—",
    ],
  ] as const;

  page2.drawText("Quoted", { x: MARGIN, y, size: 12, font: bold, color: TEXT });
  y -= 18;

  for (const [label, value] of quotedLines) {
    page2.drawText(`${label}: ${value}`, {
      x: MARGIN,
      y,
      size: 10,
      font: regular,
      color: TEXT,
    });
    y -= 14;
  }

  y -= 10;
  page2.drawText("Artwork supplied", { x: MARGIN, y, size: 12, font: bold, color: TEXT });
  y -= 18;

  const pageSize = input.preflight.metadata.pageSize.value;
  const suppliedLines = [
    ["Detected size", formatDimensionsLabel(pageSize)],
    ["Scale", input.preflight.sizeComparison?.matchedScaleLabel ?? "—"],
    [
      "Page count",
      input.preflight.metadata.pageCount != null
        ? String(input.preflight.metadata.pageCount)
        : "—",
    ],
    ["Colour mode", input.preflight.metadata.colourMode.value ?? "Unknown"],
    [
      "Effective resolution",
      input.preflight.checks.find((check) => check.key === "effective_resolution")
        ?.detectedValue ?? "—",
    ],
    [
      "Bleed metadata",
      input.preflight.checks.find((check) => check.key === "bleed_box")?.message ?? "—",
    ],
    [
      "Spot colours",
      input.preflight.metadata.spotColourNames.value.join(", ") || "—",
    ],
  ] as const;

  for (const [label, value] of suppliedLines) {
    page2.drawText(`${label}: ${value}`, {
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
  page2.drawText("AUTOMATED PREFLIGHT", { x: MARGIN, y, size: 12, font: bold, color: TEXT });
  y -= 18;

  for (const check of input.preflight.checks.filter((item) => item.status !== "info").slice(0, 8)) {
    page2.drawText(`${statusSymbol(check.status)} ${check.label}: ${check.message}`, {
      x: MARGIN,
      y,
      size: 9,
      font: regular,
      color: TEXT,
      maxWidth: contentWidth(),
      lineHeight: 11,
    });
    y -= 22;
  }

  y -= 6;
  page2.drawText(
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
}

export function buildGeneratedProofFileName(
  proofReference: string,
  versionNumber: number
) {
  return `${proofReference} Proof v${versionNumber}.pdf`;
}
