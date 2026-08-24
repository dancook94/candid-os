import type { PDFFont, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";

import {
  drawCutPathOverlayPath,
  drawCutPathSampleStroke,
} from "@/lib/proof-generator/cut-path-overlay-style";
import type {
  CutPathGeometry,
} from "@/lib/proof-generator/extract-cut-path-geometry";
import { sanitizePdfText } from "@/lib/proof-generator/pdf-text";

export {
  CUT_PATH_OVERLAY_COLOR,
  CUT_PATH_OVERLAY_DASH,
  CUT_PATH_OVERLAY_WIDTH,
} from "@/lib/proof-generator/cut-path-overlay-style";

export type ArtworkPreviewPlacement = {
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
  sourceWidthPt: number;
  sourceHeightPt: number;
};

export function computeArtworkPreviewPlacement(input: {
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
  sourceWidthPt: number;
  sourceHeightPt: number;
  padding?: number;
}): ArtworkPreviewPlacement {
  const padding = input.padding ?? 8;
  const innerWidth = input.frameWidth - padding * 2;
  const innerHeight = input.frameHeight - padding * 2;
  const scale = Math.min(
    innerWidth / input.sourceWidthPt,
    innerHeight / input.sourceHeightPt
  );
  const drawWidth = input.sourceWidthPt * scale;
  const drawHeight = input.sourceHeightPt * scale;

  return {
    frameX: input.frameX,
    frameY: input.frameY,
    frameWidth: input.frameWidth,
    frameHeight: input.frameHeight,
    drawX: input.frameX + padding + (innerWidth - drawWidth) / 2,
    drawY: input.frameY + padding + (innerHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
    sourceWidthPt: input.sourceWidthPt,
    sourceHeightPt: input.sourceHeightPt,
  };
}

export function normalizePdfPointForPreview(
  point: { x: number; y: number },
  geometry: CutPathGeometry
) {
  const { mediaBox, rotation } = geometry;
  const relativeX = point.x - mediaBox.x;
  const relativeY = point.y - mediaBox.y;
  const width = mediaBox.width;
  const height = mediaBox.height;

  switch (rotation) {
    case 90:
      return { x: relativeY, y: width - relativeX };
    case 180:
      return { x: width - relativeX, y: height - relativeY };
    case 270:
      return { x: height - relativeY, y: relativeX };
    default:
      return { x: relativeX, y: relativeY };
  }
}

export function mapPdfPointToPreview(
  point: { x: number; y: number },
  geometry: CutPathGeometry,
  placement: ArtworkPreviewPlacement
) {
  const normalized = normalizePdfPointForPreview(point, geometry);
  const scaleX = placement.drawWidth / placement.sourceWidthPt;
  const scaleY = placement.drawHeight / placement.sourceHeightPt;

  return {
    x: placement.drawX + normalized.x * scaleX,
    y: placement.drawY + normalized.y * scaleY,
  };
}

export function buildSvgPathFromGeometry(
  geometry: CutPathGeometry,
  placement: ArtworkPreviewPlacement
) {
  const parts: string[] = [];

  for (const subpath of geometry.subpaths) {
    for (const command of subpath) {
      if (command.op === "M" || command.op === "L") {
        const mapped = mapPdfPointToPreview(command, geometry, placement);
        parts.push(`${command.op} ${mapped.x} ${mapped.y}`);
        continue;
      }

      if (command.op === "C") {
        const p1 = mapPdfPointToPreview({ x: command.x1, y: command.y1 }, geometry, placement);
        const p2 = mapPdfPointToPreview({ x: command.x2, y: command.y2 }, geometry, placement);
        const p3 = mapPdfPointToPreview({ x: command.x, y: command.y }, geometry, placement);
        parts.push(`C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`);
        continue;
      }

      if (command.op === "Z") {
        parts.push("Z");
      }
    }
  }

  return parts.join(" ");
}

export function drawCutPathOverlay(
  page: PDFPage,
  geometry: CutPathGeometry,
  placement: ArtworkPreviewPlacement
) {
  const svgPath = buildSvgPathFromGeometry(geometry, placement);
  return drawCutPathOverlayPath(page, svgPath);
}

export function drawCutPathOverlayLegend(
  page: PDFPage,
  fonts: { regular: PDFFont },
  x: number,
  y: number,
  options?: { finishedCutSizeLabel?: string | null }
) {
  const label = sanitizePdfText("Cut line — does not print");
  drawCutPathSampleStroke(page, { x, y: y + 4 }, { x: x + 22, y: y + 4 });

  page.drawText(label, {
    x: x + 28,
    y: y,
    size: 7.5,
    font: fonts.regular,
    color: rgb(0.35, 0.35, 0.35),
  });

  if (options?.finishedCutSizeLabel) {
    page.drawText(sanitizePdfText(`Finished cut size: ${options.finishedCutSizeLabel}`), {
      x: x + 28,
      y: y - 11,
      size: 7,
      font: fonts.regular,
      color: rgb(0.35, 0.35, 0.35),
    });
  }
}
