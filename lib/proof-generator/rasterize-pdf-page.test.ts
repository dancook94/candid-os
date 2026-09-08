import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countDarkPixelsFromRgba } from "@/lib/proof-generator/canvas-image";
import { buildJ4LikeArtworkPdfBuffer } from "@/lib/proof-generator/j4-artwork-fixture";
import { buildContourCutTestPdfBuffer } from "@/lib/proof-generator/cut-path-test-pdfs";
import {
  countDarkPixels,
  rasterizePdfPageToPng,
  validateFlattenedArtworkPreview,
} from "@/lib/proof-generator/rasterize-pdf-page";

describe("rasterizePdfPageToPng", () => {
  it("renders a PDF page to PNG with source dimensions in points", async () => {
    const sourceBuffer = buildContourCutTestPdfBuffer({
      shape: "circle",
      cutWidthMm: 400,
      cutHeightMm: 400,
    });

    const raster = await rasterizePdfPageToPng(sourceBuffer, 0);

    assert.ok(raster.pngBuffer.byteLength > 100);
    assert.ok(raster.rgbaData instanceof Uint8ClampedArray);
    assert.equal(raster.rgbaData.length, raster.widthPx * raster.heightPx * 4);
    assert.ok(raster.widthPx > 0);
    assert.ok(raster.heightPx > 0);
    assert.ok(raster.pageWidthPt > 0);
    assert.ok(raster.pageHeightPt > 0);
    assert.equal(raster.renderer, "pdfjs-dist");
    assert.equal(raster.pngBuffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  });

  it("preserves black Test text in the J-4-like artwork fixture", async () => {
    const sourceBuffer = await buildJ4LikeArtworkPdfBuffer();

    const raster = await rasterizePdfPageToPng(sourceBuffer, 0);
    const validation = await validateFlattenedArtworkPreview({
      sourceBuffer,
      pngBuffer: raster.pngBuffer,
      rgbaData: raster.rgbaData,
      requireVisibleText: true,
    });

    assert.equal(validation.ok, true);
    if (validation.ok && !("skipped" in validation && validation.skipped)) {
      assert.ok(validation.darkPixels > 250);
    }

    const darkPixels = await countDarkPixels(raster.pngBuffer);
    assert.ok(darkPixels > 250, `expected visible Test text pixels, got ${darkPixels}`);
  });

  it("validates dark pixels from canvas rgbaData without decoding the PNG", async () => {
    const sourceBuffer = await buildJ4LikeArtworkPdfBuffer();
    const raster = await rasterizePdfPageToPng(sourceBuffer, 0);
    const expectedDarkPixels = countDarkPixelsFromRgba(raster.rgbaData);

    const validation = await validateFlattenedArtworkPreview({
      sourceBuffer,
      pngBuffer: raster.pngBuffer,
      rgbaData: raster.rgbaData,
      requireVisibleText: true,
    });

    assert.equal(validation.ok, true);
    if (validation.ok && !("skipped" in validation && validation.skipped)) {
      assert.equal(validation.darkPixels, expectedDarkPixels);
      assert.ok(validation.darkPixels > 250);
    }
  });

  it("uses rgbaData instead of the encoded PNG for dark-pixel validation", async () => {
    const sourceBuffer = await buildJ4LikeArtworkPdfBuffer();
    const raster = await rasterizePdfPageToPng(sourceBuffer, 0);
    const whiteRgba = new Uint8ClampedArray(raster.rgbaData.length).fill(255);

    const validation = await validateFlattenedArtworkPreview({
      sourceBuffer,
      pngBuffer: raster.pngBuffer,
      rgbaData: whiteRgba,
      requireVisibleText: true,
    });

    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.equal(validation.darkPixels, 0);
    }
  });
});
