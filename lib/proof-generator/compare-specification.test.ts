import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareArtworkToQuotedSize, computeEffectiveDpi } from "./compare-specification";

describe("compareArtworkToQuotedSize", () => {
  it("matches 100% scale", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 1200,
      quotedHeightMm: 800,
      detectedWidthMm: 1200,
      detectedHeightMm: 800,
    });

    assert.equal(result.matchedScale, 1);
    assert.equal(result.aspectRatioMatches, true);
    assert.equal(result.rotationMatches, false);
  });

  it("matches 50% scale", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 1200,
      quotedHeightMm: 800,
      detectedWidthMm: 600,
      detectedHeightMm: 400,
    });

    assert.equal(result.matchedScale, 0.5);
    assert.match(result.message, /50%/);
  });

  it("matches 10% scale for large format example", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 2000,
      quotedHeightMm: 1000,
      detectedWidthMm: 200,
      detectedHeightMm: 100,
    });

    assert.equal(result.matchedScale, 0.1);
  });

  it("warns when aspect ratio does not match", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 1200,
      quotedHeightMm: 800,
      detectedWidthMm: 1200,
      detectedHeightMm: 700,
    });

    assert.equal(result.matchedScale, null);
    assert.equal(result.aspectRatioMatches, false);
    assert.match(result.message, /does not match/);
  });

  it("accepts rotated dimension match", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 1200,
      quotedHeightMm: 800,
      detectedWidthMm: 800,
      detectedHeightMm: 1200,
    });

    assert.equal(result.matchedScale, 1);
    assert.equal(result.rotationMatches, true);
  });
});

describe("computeEffectiveDpi", () => {
  it("calculates effective DPI at finished size", () => {
    const dpi = computeEffectiveDpi({
      widthPx: 2400,
      heightPx: 1600,
      artworkWidthMm: 600,
      artworkHeightMm: 400,
      finishedScale: 0.5,
    });

    assert.ok(dpi != null);
    assert.ok(dpi > 0);
  });
});
