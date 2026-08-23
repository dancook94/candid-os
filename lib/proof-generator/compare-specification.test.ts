import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareArtworkToQuotedSize,
  computeArtworkDpi,
  computeEffectiveDpi,
  formatScalePercentLabel,
} from "./compare-specification";

describe("compareArtworkToQuotedSize", () => {
  it("matches 100% scale", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 1200,
      quotedHeightMm: 800,
      detectedWidthMm: 1200,
      detectedHeightMm: 800,
    });

    assert.equal(result.matchedScale, 1);
    assert.equal(result.comparisonStatus, "pass");
    assert.equal(result.aspectRatioMatches, true);
    assert.equal(result.rotationMatches, false);
    assert.match(result.message, /Finished artwork size matches quoted specification/);
  });

  it("matches 50% scale", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 5000,
      quotedHeightMm: 1000,
      detectedWidthMm: 2500,
      detectedHeightMm: 500,
    });

    assert.equal(result.matchedScale, 0.5);
    assert.equal(result.comparisonStatus, "pass");
    assert.match(result.message, /50%/);
  });

  it("matches 10% scale for large format example", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 5000,
      quotedHeightMm: 1000,
      detectedWidthMm: 500,
      detectedHeightMm: 100,
    });

    assert.equal(result.matchedScale, 0.1);
    assert.equal(result.comparisonStatus, "pass");
    assert.match(result.message, /10%/);
  });

  it("matches 5% scale", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 4000,
      quotedHeightMm: 2000,
      detectedWidthMm: 200,
      detectedHeightMm: 100,
    });

    assert.equal(result.matchedScale, 0.05);
    assert.equal(result.comparisonStatus, "pass");
  });

  it("matches custom scale when both axes agree", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 5000,
      quotedHeightMm: 1000,
      detectedWidthMm: 750,
      detectedHeightMm: 150,
    });

    assert.equal(result.matchedScale, 0.15);
    assert.equal(result.comparisonStatus, "pass");
    assert.equal(formatScalePercentLabel(0.15), "15%");
  });

  it("requires review when width and height scales disagree", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 5000,
      quotedHeightMm: 1000,
      detectedWidthMm: 500,
      detectedHeightMm: 200,
    });

    assert.equal(result.matchedScale, null);
    assert.equal(result.comparisonStatus, "manual_review");
    assert.equal(result.widthScalePercent, 10);
    assert.equal(result.heightScalePercent, 20);
    assert.match(result.message, /Width scale:/);
    assert.match(result.message, /Height scale:/);
  });

  it("does not treat a single matching dimension as a scaled match", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 1200,
      quotedHeightMm: 800,
      detectedWidthMm: 1200,
      detectedHeightMm: 700,
    });

    assert.equal(result.matchedScale, null);
    assert.equal(result.comparisonStatus, "manual_review");
    assert.match(result.message, /proportions do not match/);
  });

  it("accepts rotated dimension match at 10% scale", () => {
    const result = compareArtworkToQuotedSize({
      quotedWidthMm: 5000,
      quotedHeightMm: 1000,
      detectedWidthMm: 100,
      detectedHeightMm: 500,
    });

    assert.equal(result.matchedScale, 0.1);
    assert.equal(result.comparisonStatus, "pass");
    assert.equal(result.rotationMatches, true);
  });

  it("accepts rotated 100% dimension match", () => {
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

describe("computeArtworkDpi", () => {
  it("calculates artwork DPI from pixel dimensions", () => {
    const dpi = computeArtworkDpi({
      widthPx: 3000,
      heightPx: 2000,
      artworkWidthMm: 254,
      artworkHeightMm: 169.33,
    });

    assert.equal(dpi, 300);
  });
});

describe("computeEffectiveDpi", () => {
  it("calculates effective DPI at finished size from scale", () => {
    const dpi = computeEffectiveDpi({
      widthPx: 3000,
      heightPx: 2000,
      artworkWidthMm: 254,
      artworkHeightMm: 169.33,
      finishedScale: 0.1,
    });

    assert.equal(dpi, 30);
  });

  it("calculates effective DPI at 50% scale", () => {
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
