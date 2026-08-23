import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analysePdfBuffer } from "@/lib/proof-generator/analyse-pdf";
import { compareArtworkToQuotedSize } from "@/lib/proof-generator/compare-specification";
import { buildTrimBoxTestPdfBuffer } from "@/lib/proof-generator/cut-path-test-pdfs";
import {
  computeBleedAllowanceFromBoxes,
  resolveFinishedArtworkSize,
} from "@/lib/proof-generator/resolve-pdf-geometry";

describe("resolveFinishedArtworkSize", () => {
  it("prefers TrimBox over MediaBox for finished size", async () => {
    const buffer = buildTrimBoxTestPdfBuffer();
    const metadata = await analysePdfBuffer(buffer, "trim-box.pdf", "application/pdf");

    assert.ok(metadata.mediaBox.value);
    assert.ok(metadata.trimBox.value);
    assert.ok(metadata.finishedSize?.value);

    assert.equal(metadata.finishedSizeSource?.value, "trim_box");
    assert.ok(Math.abs((metadata.finishedSize?.value?.widthMm ?? 0) - 500) < 0.05);
    assert.ok(Math.abs((metadata.finishedSize?.value?.heightMm ?? 0) - 500) < 0.05);
    assert.ok(Math.abs((metadata.pageSize.value?.widthMm ?? 0) - 523.28) < 0.05);
    assert.ok(Math.abs((metadata.pageSize.value?.heightMm ?? 0) - 523.28) < 0.05);

    const bleed = metadata.bleedAllowanceMm?.value;
    assert.ok(bleed != null);
    assert.ok(Math.abs(bleed - 11.64) <= 0.1);
  });

  it("uses trim size for 10% scale detection against quoted specification", async () => {
    const buffer = buildTrimBoxTestPdfBuffer();
    const metadata = await analysePdfBuffer(buffer, "trim-box.pdf", "application/pdf");
    const finishedSize = metadata.finishedSize?.value;

    const comparison = compareArtworkToQuotedSize({
      quotedWidthMm: 5000,
      quotedHeightMm: 5000,
      detectedWidthMm: finishedSize?.widthMm ?? null,
      detectedHeightMm: finishedSize?.heightMm ?? null,
      finishedSizeSource: metadata.finishedSizeSource?.value ?? null,
    });

    assert.equal(comparison.matchedScale, 0.1);
    assert.equal(comparison.comparisonStatus, "pass");
    assert.match(comparison.message, /10%/);
  });

  it("falls back to media box when trim metadata is unavailable", () => {
    const pageSize = {
      widthPt: 200,
      heightPt: 200,
      widthMm: 70.56,
      heightMm: 70.56,
    };

    const resolved = resolveFinishedArtworkSize({
      pageSize,
      trimBox: null,
      artBox: null,
      cropBox: null,
      mediaBox: pageSize,
      bleedBox: null,
    });

    assert.equal(resolved.finishedSizeSource.value, "media_box");
    assert.equal(resolved.finishedSize.value?.widthMm, 70.56);
  });

  it("computes bleed allowance from page and trim boxes", () => {
    const allowance = computeBleedAllowanceFromBoxes({
      finishedSize: {
        widthPt: 1417.32,
        heightPt: 1417.32,
        widthMm: 500,
        heightMm: 500,
      },
      bleedBox: null,
      pageSize: {
        widthPt: 1483.28,
        heightPt: 1483.28,
        widthMm: 523.28,
        heightMm: 523.28,
      },
    });

    assert.ok(allowance != null);
    assert.ok(Math.abs(allowance - 11.64) <= 0.1);
  });
});
