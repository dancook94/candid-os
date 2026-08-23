import type { PDFFont, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";

import type {
  CutPathGeometry,
  CutPathPathCommand,
} from "@/lib/proof-generator/extract-cut-path-geometry";
import { sanitizePdfText } from "@/lib/proof-generator/pdf-text";

export const CUT_PATH_OVERLAY_COLOR = rgb(0.92, 0.2, 0.62);
export const CUT_PATH_OVERLAY_WIDTH = 1.25;
export const CUT_PATH_OVERLAY_DASH = [4, 3] as const;

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

function mapCommandToPreview(
  command: CutPathPathCommand,
  geometry: CutPathGeometry,
  placement: ArtworkPreviewPlacement
): CutPathPathCommand {
  if (command.op === "M" || command.op === "L") {
    const mapped = mapPdfPointToPreview(command, geometry, placement);
    return command.op === "M"
      ? { op: "M", x: mapped.x, y: mapped.y }
      : { op: "L", x: mapped.x, y: mapped.y };
  }

  if (command.op === "C") {
    const p1 = mapPdfPointToPreview({ x: command.x1, y: command.y1 }, geometry, placement);
    const p2 = mapPdfPointToPreview({ x: command.x2, y: command.y2 }, geometry, placement);
    const p3 = mapPdfPointToPreview({ x: command.x, y: command.y }, geometry, placement);
    return { op: "C", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p3.x, y: p3.y };
  }

  return command;
}

export function buildSvgPathFromGeometry(
  geometry: CutPathGeometry,
  placement: ArtworkPreviewPlacement
) {
  const parts: string[] = [];

  for (const subpath of geometry.subpaths) {
    for (const command of subpath) {
      const mapped = mapCommandToPreview(command, geometry, placement);

      if (mapped.op === "M") {
        parts.push(`M ${mapped.x} ${mapped.y}`);
      } else if (mapped.op === "L") {
        parts.push(`L ${mapped.x} ${mapped.y}`);
      } else if (mapped.op === "C") {
        parts.push(
          `C ${mapped.x1} ${mapped.y1} ${mapped.x2} ${mapped.y2} ${mapped.x} ${mapped.y}`
        );
      } else if (mapped.op === "Z") {
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
  const path = buildSvgPathFromGeometry(geometry, placement);
  if (!path.trim()) {
    return false;
  }

  page.drawSvgPath(path, {
    x: 0,
    y: 0,
    borderColor: CUT_PATH_OVERLAY_COLOR,
    borderWidth: CUT_PATH_OVERLAY_WIDTH,
    borderDashArray: [...CUT_PATH_OVERLAY_DASH],
    borderLineCap: 1,
  });

  return true;
}

export function drawCutPathOverlayLegend(
  page: PDFPage,
  fonts: { regular: PDFFont },
  x: number,
  y: number
) {
  const label = sanitizePdfText("Cut path shown for reference only");
  page.drawLine({
    start: { x, y: y + 3 },
    end: { x: x + 18, y: y + 3 },
    thickness: CUT_PATH_OVERLAY_WIDTH,
    color: CUT_PATH_OVERLAY_COLOR,
    dashArray: [...CUT_PATH_OVERLAY_DASH],
  });

  page.drawText(label, {
    x: x + 24,
    y: y,
    size: 7.5,
    font: fonts.regular,
    color: rgb(0.45, 0.45, 0.45),
  });
}
