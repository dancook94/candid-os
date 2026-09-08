import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countDarkPixelsFromRgba } from "@/lib/proof-generator/canvas-image";
import { buildJ4LikeArtworkPdfBuffer } from "@/lib/proof-generator/j4-artwork-fixture";
import { buildContourCutTestPdfBuffer } from "@/lib/proof-generator/cut-path-test-pdfs";
import {
  countDarkPixels,
  missingPdfPreviewPixelDataError,
  rasterizePdfPageToPng,
  resolvePdfJsAssetUrls,
  validateFlattenedArtworkPreview,
} from "@/lib/proof-generator/rasterize-pdf-page";

describe("resolvePdfJsAssetUrls", () => {
  it("resolves pdfjs asset directories from a filesystem path string, not a bundler module id", () => {
    const assets = resolvePdfJsAssetUrls();

    assert.equal(typeof assets.pdfjsRoot, "string");
    assert.match(assets.pdfjsRoot, /pdfjs-dist/);
    assert.match(assets.standardFontDataUrl, /^file:\/\//);
    assert.match(assets.standardFontDataUrl, /standard_fonts/);
    assert.match(assets.cMapUrl, /^file:\/\//);
    assert.match(assets.cMapUrl, /cmaps/);
    assert.doesNotMatch(assets.pdfjsRoot, /^\d+$/);
  });
});

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
      renderedWidthPx: raster.widthPx,
      renderedHeightPx: raster.heightPx,
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
      renderedWidthPx: raster.widthPx,
      renderedHeightPx: raster.heightPx,
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
      renderedWidthPx: raster.widthPx,
      renderedHeightPx: raster.heightPx,
      requireVisibleText: true,
    });

    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.equal(validation.darkPixels, 0);
    }
  });

  it("throws when PDF validation requires pixels but rgbaData is missing", async () => {
    const sourceBuffer = await buildJ4LikeArtworkPdfBuffer();
    const raster = await rasterizePdfPageToPng(sourceBuffer, 0);

    await assert.rejects(
      () =>
        validateFlattenedArtworkPreview({
          sourceBuffer,
          pngBuffer: raster.pngBuffer,
          renderedWidthPx: raster.widthPx,
          renderedHeightPx: raster.heightPx,
          requireVisibleText: true,
        }),
      (error: Error) => {
        assert.match(error.message, /Rendered PDF preview pixel data is unavailable/);
        assert.match(error.message, /rgbaDataPresent=false/);
        assert.match(error.message, /pngBufferLength=\d+/);
        assert.match(error.message, /renderedWidthPx=\d+/);
        assert.match(error.message, /renderedHeightPx=\d+/);
        return true;
      }
    );
  });

  it("formats missing rgbaData diagnostics", () => {
    const error = missingPdfPreviewPixelDataError({
      pngBuffer: Buffer.alloc(55876),
      renderedWidthPx: 384,
      renderedHeightPx: 384,
    });

    assert.match(error.message, /rgbaDataPresent=false/);
    assert.match(error.message, /pngBufferLength=55876/);
    assert.match(error.message, /renderedWidthPx=384/);
    assert.match(error.message, /renderedHeightPx=384/);
  });
});
