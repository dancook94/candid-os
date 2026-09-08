import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countDarkPixelsFromPng,
  countDarkPixelsFromRgba,
} from "@/lib/proof-generator/canvas-image";
import { buildJ4LikeArtworkPdfBuffer } from "@/lib/proof-generator/j4-artwork-fixture";
import {
  countDarkPixels,
  rasterizePdfPageToPng,
} from "@/lib/proof-generator/rasterize-pdf-page";

describe("canvas-image", () => {
  it("counts dark pixels from RGBA data without sharp", () => {
    const data = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      10, 20, 30, 255,
    ]);

    assert.equal(countDarkPixelsFromRgba(data, 80), 2);
  });

  it("counts dark pixels from a rasterized PNG without sharp", async () => {
    const sourceBuffer = await buildJ4LikeArtworkPdfBuffer();
    const raster = await rasterizePdfPageToPng(sourceBuffer, 0);

    const darkPixels = await countDarkPixels(raster.pngBuffer);
    const darkPixelsFromCanvas = await countDarkPixelsFromPng(raster.pngBuffer);

    assert.ok(darkPixels > 250);
    assert.equal(darkPixels, darkPixelsFromCanvas);
  });
});
