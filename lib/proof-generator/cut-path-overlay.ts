import type { PDFFont, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";

import type {
  CutPathGeometry,
  CutPathPathCommand,
} from "@/lib/proof-generator/extract-cut-path-geometry";
import { sanitizePdfText } from "@/lib/proof-generator/pdf-text";

/** Proof-only cut path magenta (#EC008C). */
export const CUT_PATH_OVERLAY_COLOR = rgb(236 / 255, 0, 140 / 255);
export const CUT_PATH_OVERLAY_WIDTH = 1.75;
export const CUT_PATH_OVERLAY_DASH = [5, 4] as const;

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

function flattenCubicBezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  segments = 16
) {
  const points: Array<{ x: number; y: number }> = [];

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const mt = 1 - t;
    points.push({
      x:
        mt * mt * mt * p0.x +
        3 * mt * mt * t * p1.x +
        3 * mt * t * t * p2.x +
        t * t * t * p3.x,
      y:
        mt * mt * mt * p0.y +
        3 * mt * mt * t * p1.y +
        3 * mt * t * t * p2.y +
        t * t * t * p3.y,
    });
  }

  return points;
}

function subpathToPreviewPoints(
  subpath: CutPathPathCommand[],
  geometry: CutPathGeometry,
  placement: ArtworkPreviewPlacement
) {
  const segments: Array<{ start: { x: number; y: number }; end: { x: number; y: number } }> = [];
  let current: { x: number; y: number } | null = null;
  let subpathStart: { x: number; y: number } | null = null;

  for (const command of subpath) {
    if (command.op === "M") {
      current = mapPdfPointToPreview(command, geometry, placement);
      subpathStart = current;
      continue;
    }

    if (!current) {
      continue;
    }

    if (command.op === "L") {
      const end = mapPdfPointToPreview(command, geometry, placement);
      segments.push({ start: current, end });
      current = end;
      continue;
    }

    if (command.op === "C") {
      const control1 = mapPdfPointToPreview(
        { x: command.x1, y: command.y1 },
        geometry,
        placement
      );
      const control2 = mapPdfPointToPreview(
        { x: command.x2, y: command.y2 },
        geometry,
        placement
      );
      const end = mapPdfPointToPreview({ x: command.x, y: command.y }, geometry, placement);
      const flattened = flattenCubicBezier(current, control1, control2, end);

      for (let index = 1; index < flattened.length; index += 1) {
        segments.push({
          start: flattened[index - 1],
          end: flattened[index],
        });
      }

      current = end;
      continue;
    }

    if (command.op === "Z" && subpathStart) {
      segments.push({ start: current, end: subpathStart });
      current = subpathStart;
    }
  }

  return segments;
}

function drawDashedLine(
  page: PDFPage,
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length < 0.01) {
    return;
  }

  const [dash, gap] = CUT_PATH_OVERLAY_DASH;
  const patternLength = dash + gap;
  let travelled = 0;

  while (travelled < length) {
    const dashStart = travelled / length;
    const dashEnd = Math.min((travelled + dash) / length, 1);

    if (dashEnd > dashStart) {
      page.drawLine({
        start: {
          x: start.x + dx * dashStart,
          y: start.y + dy * dashStart,
        },
        end: {
          x: start.x + dx * dashEnd,
          y: start.y + dy * dashEnd,
        },
        thickness: CUT_PATH_OVERLAY_WIDTH,
        color: CUT_PATH_OVERLAY_COLOR,
        lineCap: 1,
      });
    }

    travelled += patternLength;
  }
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
  let segmentsDrawn = 0;

  for (const subpath of geometry.subpaths) {
    if (subpath.length === 0) {
      continue;
    }

    const segments = subpathToPreviewPoints(subpath, geometry, placement);
    for (const segment of segments) {
      drawDashedLine(page, segment.start, segment.end);
      segmentsDrawn += 1;
    }
  }

  return segmentsDrawn > 0;
}

export function drawCutPathOverlayLegend(
  page: PDFPage,
  fonts: { regular: PDFFont },
  x: number,
  y: number
) {
  const label = sanitizePdfText("Cut path — does not print");
  page.drawLine({
    start: { x, y: y + 4 },
    end: { x: x + 22, y: y + 4 },
    thickness: CUT_PATH_OVERLAY_WIDTH,
    color: CUT_PATH_OVERLAY_COLOR,
    dashArray: [...CUT_PATH_OVERLAY_DASH],
    lineCap: 1,
  });

  page.drawText(label, {
    x: x + 28,
    y: y,
    size: 7.5,
    font: fonts.regular,
    color: rgb(0.35, 0.35, 0.35),
  });
}
