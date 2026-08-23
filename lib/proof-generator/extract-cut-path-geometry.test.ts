import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeArtworkPreviewPlacement,
  mapPdfPointToPreview,
} from "@/lib/proof-generator/cut-path-overlay";
import { buildCutPathTestPdfBuffer } from "@/lib/proof-generator/cut-path-test-pdfs";
import {
  buildIllustratorFormXObjectCutPathPdfBuffer,
  buildIllustratorInlineSeparationCutPathPdfBuffer,
  buildIllustratorNestedFormCutPathPdfBuffer,
} from "@/lib/proof-generator/cut-path-test-pdfs";
import {
  extractCutPathGeometry,
  formatCutPathExtractionFailureReason,
} from "@/lib/proof-generator/extract-cut-path-geometry";

describe("extractCutPathGeometry", () => {
  it("extracts rectangular CutContour geometry", async () => {
    const buffer = buildCutPathTestPdfBuffer({ shape: "rectangle" });
    const result = await extractCutPathGeometry(buffer, "CutContour", 0);

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.ok(result.geometry.subpaths.length >= 1);
    const points = result.geometry.subpaths.flatMap((subpath) =>
      subpath.filter((command) => command.op === "M" || command.op === "L")
    );
    assert.ok(points.some((point) => "x" in point && point.x === 50 && point.y === 50));
    assert.ok(points.some((point) => "x" in point && point.x === 150 && point.y === 150));
  });

  it("extracts circular CutContour geometry", async () => {
    const buffer = buildCutPathTestPdfBuffer({ shape: "circle" });
    const result = await extractCutPathGeometry(buffer, "CutContour", 0);

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.ok(
      result.geometry.subpaths.some((subpath) =>
        subpath.some((command) => command.op === "C")
      )
    );
  });

  it("extracts irregular CutContour geometry", async () => {
    const buffer = buildCutPathTestPdfBuffer({ shape: "irregular" });
    const result = await extractCutPathGeometry(buffer, "CutContour", 0);

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.ok(result.geometry.subpaths.length >= 1);
  });

  it("returns no geometry when CutContour is absent", async () => {
    const buffer = buildCutPathTestPdfBuffer({ shape: "rectangle", includeCutPath: false });
    const result = await extractCutPathGeometry(buffer, "CutContour", 0);

    assert.equal(result.ok, false);
  });

  it("extracts geometry from flate-compressed content streams", async () => {
    const buffer = buildCutPathTestPdfBuffer({ shape: "rectangle", compress: true });
    const result = await extractCutPathGeometry(buffer, "CutContour", 0);

    assert.equal(result.ok, true);
  });

  it("extracts geometry from Illustrator Form XObject with indirect resources", async () => {
    const buffer = buildIllustratorFormXObjectCutPathPdfBuffer({ shape: "rectangle" });
    const result = await extractCutPathGeometry(buffer, "CutContour", 0);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.geometry.subpaths.length >= 1);
    }
  });

  it("extracts geometry from inline Separation color space arrays", async () => {
    const buffer = buildIllustratorInlineSeparationCutPathPdfBuffer({ shape: "circle" });
    const result = await extractCutPathGeometry(buffer, "CutContour", 0);

    assert.equal(result.ok, true);
  });

  it("extracts geometry from nested Form XObjects", async () => {
    const buffer = buildIllustratorNestedFormCutPathPdfBuffer();
    const result = await extractCutPathGeometry(buffer, "CutContour", 0);

    assert.equal(result.ok, true);
  });

  it("returns actionable internal diagnostics when geometry is missing", async () => {
    const buffer = buildCutPathTestPdfBuffer({ shape: "rectangle", includeCutPath: false });
    const result = await extractCutPathGeometry(buffer, "CutContour", 0);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(
        formatCutPathExtractionFailureReason(result.diagnostic) ?? "",
        /CutContour separation detected/i
      );
    }
  });
});

describe("cut path preview coordinate mapping", () => {
  it("maps PDF rectangle corners into preview placement space", () => {
    const placement = computeArtworkPreviewPlacement({
      frameX: 20,
      frameY: 100,
      frameWidth: 200,
      frameHeight: 200,
      sourceWidthPt: 200,
      sourceHeightPt: 200,
    });

    const geometry = {
      subpaths: [],
      pageIndex: 0,
      mediaBox: { x: 0, y: 0, width: 200, height: 200 },
      rotation: 0,
    };

    const bottomLeft = mapPdfPointToPreview({ x: 50, y: 50 }, geometry, placement);
    const topRight = mapPdfPointToPreview({ x: 150, y: 150 }, geometry, placement);

    assert.ok(topRight.x > bottomLeft.x);
    assert.ok(topRight.y > bottomLeft.y);
    assert.equal(bottomLeft.x, placement.drawX + 50 * (placement.drawWidth / 200));
    assert.equal(bottomLeft.y, placement.drawY + 50 * (placement.drawHeight / 200));
  });
});
