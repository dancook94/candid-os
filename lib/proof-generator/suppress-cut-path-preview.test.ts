import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildContourCutTestPdfBuffer,
  buildCutPathTestPdfBuffer,
  buildJ4LikeContourCutPdfBuffer,
  buildOcgCutPathPdfBuffer,
  buildOcgCutPathWithArtworkPdfBuffer,
  buildOcgArtworkInsideCutContourPdfBuffer,
} from "@/lib/proof-generator/cut-path-test-pdfs";
import { createCustomerPreviewPdfBuffer } from "@/lib/proof-generator/suppress-cut-path-preview";
import {
  rasterizePdfPageToPng,
  validateFlattenedArtworkPreview,
} from "@/lib/proof-generator/rasterize-pdf-page";

describe("createCustomerPreviewPdfBuffer", () => {
  it("suppresses OCG CutContour content from preview copy", async () => {
    const sourceBuffer = buildOcgCutPathPdfBuffer({ shape: "rectangle" });
    const result = await createCustomerPreviewPdfBuffer(sourceBuffer, {
      name: "CutContour",
      sourceType: "optional_content_group",
    });

    assert.equal(result.originalCutPathSuppressed, true);
    assert.equal(result.method, "ocg_content_filter");
    assert.notEqual(result.buffer.toString("latin1"), sourceBuffer.toString("latin1"));
  });

  it("suppresses separation CutContour strokes from preview copy", async () => {
    const sourceBuffer = buildCutPathTestPdfBuffer({ shape: "rectangle" });
    const result = await createCustomerPreviewPdfBuffer(sourceBuffer, {
      name: "CutContour",
      sourceType: "separation",
    });

    assert.equal(result.originalCutPathSuppressed, true);
    assert.equal(result.method, "separation_content_filter");
  });

  it("does not suppress when cut path is not confirmed", async () => {
    const sourceBuffer = buildCutPathTestPdfBuffer({ shape: "rectangle" });
    const result = await createCustomerPreviewPdfBuffer(sourceBuffer, null);

    assert.equal(result.originalCutPathSuppressed, false);
    assert.equal(result.method, "none");
    assert.equal(result.buffer, sourceBuffer);
  });

  it("falls back safely for unsupported source types", async () => {
    const sourceBuffer = buildCutPathTestPdfBuffer({ shape: "rectangle" });
    const result = await createCustomerPreviewPdfBuffer(sourceBuffer, {
      name: "CutContour",
      sourceType: "layer",
    });

    assert.equal(result.originalCutPathSuppressed, false);
    assert.equal(result.method, "unsupported_source");
  });

  it("preserves artwork when suppressing separation CutContour on J-4-like PDF", async () => {
    const sourceBuffer = buildContourCutTestPdfBuffer({ shape: "circle" });
    const result = await createCustomerPreviewPdfBuffer(sourceBuffer, {
      name: "CutContour",
      sourceType: "separation",
    });

    assert.match(result.buffer.toString("latin1"), /0\.9 0\.9 0\.9 rg/);
    assert.match(result.buffer.toString("latin1"), /re f/);
  });

  it("suppresses CutContour separation while preserving red artwork and Test text", async () => {
    const sourceBuffer = buildJ4LikeContourCutPdfBuffer();
    const result = await createCustomerPreviewPdfBuffer(sourceBuffer, {
      name: "CutContour",
      sourceType: "separation",
    });

    assert.equal(result.originalCutPathSuppressed, true);
    assert.match(result.buffer.toString("latin1"), /0\.86 0\.08 0\.08 rg/);
    assert.match(result.buffer.toString("latin1"), /\(Test\) Tj/);

    const raster = await rasterizePdfPageToPng(result.buffer, 0);
    const validation = await validateFlattenedArtworkPreview({
      sourceBuffer,
      pngBuffer: raster.pngBuffer,
      requireVisibleText: true,
    });

    assert.equal(validation.ok, true);
  });

  it("preserves artwork when suppressing OCG CutContour beside artwork", async () => {
    const sourceBuffer = buildOcgCutPathWithArtworkPdfBuffer({ shape: "rectangle" });
    const result = await createCustomerPreviewPdfBuffer(sourceBuffer, {
      name: "CutContour",
      sourceType: "optional_content_group",
    });

    assert.match(result.buffer.toString("latin1"), /0\.9 0\.9 0\.9 rg/);
    assert.match(result.buffer.toString("latin1"), /re f/);
  });

  it("falls back when artwork lives inside the CutContour OCG", async () => {
    const sourceBuffer = buildOcgArtworkInsideCutContourPdfBuffer({ shape: "rectangle" });
    const result = await createCustomerPreviewPdfBuffer(sourceBuffer, {
      name: "CutContour",
      sourceType: "optional_content_group",
    });

    assert.equal(result.originalCutPathSuppressed, false);
    assert.match(result.suppressionReason ?? "", /artwork|content/i);
    assert.match(result.buffer.toString("latin1"), /0\.9 0\.9 0\.9 rg/);
  });
});
