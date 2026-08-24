import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument } from "pdf-lib";

import {
  CUT_PATH_OVERLAY_DASH,
  drawCutPathOverlayPath,
  getCutPathOverlayStrokeOptions,
} from "@/lib/proof-generator/cut-path-overlay-style";
import { drawCutPathOverlay } from "@/lib/proof-generator/cut-path-overlay";
import type { CutPathGeometry } from "@/lib/proof-generator/extract-cut-path-geometry";
import { buildCutPathTestPdfBuffer } from "@/lib/proof-generator/cut-path-test-pdfs";
import { extractCutPathGeometry } from "@/lib/proof-generator/extract-cut-path-geometry";

describe("cut path overlay style", () => {
  it("uses one shared dash pattern for legend and overlay strokes", () => {
    const stroke = getCutPathOverlayStrokeOptions();
    assert.deepEqual(stroke.borderDashArray, [...CUT_PATH_OVERLAY_DASH]);
    assert.equal(stroke.borderWidth, 1.75);
  });

  it("renders cut overlay geometry through a single dashed SVG path", async () => {
    const sourceBuffer = buildCutPathTestPdfBuffer({ shape: "circle" });
    const extraction = await extractCutPathGeometry(sourceBuffer, "CutContour", 0);
    assert.equal(extraction.ok, true);
    if (!extraction.ok) {
      return;
    }

    const document = await PDFDocument.create();
    const page = document.addPage([400, 400]);
    const placement = {
      frameX: 20,
      frameY: 20,
      frameWidth: 360,
      frameHeight: 360,
      drawX: 40,
      drawY: 40,
      drawWidth: 320,
      drawHeight: 320,
      sourceWidthPt: 200,
      sourceHeightPt: 200,
    };

    assert.equal(
      drawCutPathOverlay(page, extraction.geometry as CutPathGeometry, placement),
      true
    );

    const bytes = await document.save();
    assert.ok(bytes.byteLength > 500);
  });

  it("draws dashed overlay paths through drawCutPathOverlayPath", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([200, 200]);
    assert.equal(drawCutPathOverlayPath(page, "M 20 20 L 120 20 L 120 120 Z"), true);

    const bytes = await document.save();
    assert.ok(bytes.byteLength > 200);
  });
});
