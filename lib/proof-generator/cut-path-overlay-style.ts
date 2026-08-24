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

export function drawCutPathOverlayPath(page: PDFPage, svgPath: string) {
  if (!svgPath.trim()) {
    return false;
  }

  page.drawSvgPath(svgPath, getCutPathOverlayStrokeOptions());
  return true;
}
