import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildContourCutTestPdfBuffer } from "@/lib/proof-generator/cut-path-test-pdfs";
import { rasterizePdfPageToPng } from "@/lib/proof-generator/rasterize-pdf-page";

describe("rasterizePdfPageToPng", () => {
  it("renders a PDF page to PNG with source dimensions in points", async () => {
    const sourceBuffer = buildContourCutTestPdfBuffer({
      shape: "circle",
      cutWidthMm: 400,
      cutHeightMm: 400,
    });

    const raster = await rasterizePdfPageToPng(sourceBuffer, 0);

    assert.ok(raster.pngBuffer.byteLength > 100);
    assert.ok(raster.widthPx > 0);
    assert.ok(raster.heightPx > 0);
    assert.ok(raster.pageWidthPt > 0);
    assert.ok(raster.pageHeightPt > 0);
    assert.equal(raster.pngBuffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  });
});
