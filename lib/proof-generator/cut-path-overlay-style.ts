import type { PDFPage } from "pdf-lib";
import { LineCapStyle, rgb } from "pdf-lib";

/** Proof-only cut path magenta (#EC008C). */
export const CUT_PATH_OVERLAY_COLOR = rgb(236 / 255, 0, 140 / 255);

/** Stroke width for customer-proof cut overlays at proof display size. */
export const CUT_PATH_OVERLAY_WIDTH = 1.75;

/** Dash pattern shared by artwork overlay and Page 1 legend sample. */
export const CUT_PATH_OVERLAY_DASH = [5, 4] as const;

export const CUT_PATH_OVERLAY_LINE_CAP = LineCapStyle.Round;

export type CutPathOverlayStrokeOptions = {
  borderColor: typeof CUT_PATH_OVERLAY_COLOR;
  borderWidth: number;
  borderDashArray: number[];
  borderLineCap: LineCapStyle;
};

export type CutPathDashCursor = {
  distance: number;
};

export function createCutPathDashCursor(): CutPathDashCursor {
  return { distance: 0 };
}

export function getCutPathOverlayStrokeOptions(): CutPathOverlayStrokeOptions {
  return {
    borderColor: CUT_PATH_OVERLAY_COLOR,
    borderWidth: CUT_PATH_OVERLAY_WIDTH,
    borderDashArray: [...CUT_PATH_OVERLAY_DASH],
    borderLineCap: CUT_PATH_OVERLAY_LINE_CAP,
  };
}

export function getCutPathOverlayLineOptions() {
  const stroke = getCutPathOverlayStrokeOptions();
  return {
    thickness: stroke.borderWidth,
    color: stroke.borderColor,
    dashArray: stroke.borderDashArray,
    lineCap: stroke.borderLineCap,
  };
}

/** Legend sample line — must visually match the artwork overlay stroke. */
export function drawCutPathSampleStroke(
  page: PDFPage,
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  page.drawLine({
    start,
    end,
    ...getCutPathOverlayLineOptions(),
  });
}

/**
 * Draw one overlay segment with a dash pattern that continues across the full path.
 * Uses explicit dash chunks instead of drawSvgPath so curves stay visibly dashed in Acrobat.
 */
export function drawCutPathOverlaySegment(
  page: PDFPage,
  start: { x: number; y: number },
  end: { x: number; y: number },
  cursor: CutPathDashCursor
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length < 0.01) {
    return false;
  }

  const [dash, gap] = CUT_PATH_OVERLAY_DASH;
  const patternLength = dash + gap;
  const { dashArray: _ignoredDash, ...lineOptions } = getCutPathOverlayLineOptions();
  let travelled = 0;
  let drawn = false;

  while (travelled < length) {
    const patternOffset = (cursor.distance + travelled) % patternLength;
    const remainingInPattern =
      patternOffset < dash ? dash - patternOffset : patternLength - patternOffset;
    const step = Math.min(remainingInPattern, length - travelled);

    if (patternOffset < dash) {
      const startRatio = travelled / length;
      const endRatio = (travelled + step) / length;
      page.drawLine({
        start: {
          x: start.x + dx * startRatio,
          y: start.y + dy * startRatio,
        },
        end: {
          x: start.x + dx * endRatio,
          y: start.y + dy * endRatio,
        },
        ...lineOptions,
      });
      drawn = true;
    }

    travelled += step;
  }

  cursor.distance += length;
  return drawn;
}
