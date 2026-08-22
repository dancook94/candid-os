import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateCustomerProofPdf } from "@/lib/proof-generator/generate-proof-pdf";
import type { PreflightResult } from "@/lib/proof-generator/types";

const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function buildPreflight(overrides?: Partial<PreflightResult>): PreflightResult {
  return {
    analysisVersion: "phase1",
    overallStatus: "warning",
    checks: [
      {
        key: "colour_mode",
        label: "Colour mode",
        status: "warning",
        detectedValue: "RGB",
        expectedValue: "CMYK",
        message: "RGB content detected",
        confidence: "high",
      },
      {
        key: "size_scale",
        label: "Size / scale",
        status: "pass",
        detectedValue: "1200 x 800 mm",
        expectedValue: "1200 x 800 mm",
        message: "Artwork dimensions match quoted specification",
        confidence: "high",
      },
    ],
    metadata: {
      fileName: "proof.png",
      fileSizeBytes: MINIMAL_PNG.length,
      mimeType: "image/png",
      inputType: "image",
      pageCount: 1,
      pdfVersion: { value: null, confidence: "low", source: "n/a" },
      pageSize: {
        value: { widthPt: 0, heightPt: 0, widthMm: 1200, heightMm: 800 },
        confidence: "high",
        source: "image",
      },
      orientation: { value: "landscape", confidence: "high", source: "image" },
      mediaBox: { value: null, confidence: "low", source: "n/a" },
      cropBox: { value: null, confidence: "low", source: "n/a" },
      trimBox: { value: null, confidence: "low", source: "n/a" },
      bleedBox: { value: null, confidence: "low", source: "n/a" },
      artBox: { value: null, confidence: "low", source: "n/a" },
      colourMode: { value: "RGB", confidence: "high", source: "image" },
      cmykPresent: { value: false, confidence: "high", source: "image" },
      rgbPresent: { value: true, confidence: "high", source: "image" },
      grayscalePresent: { value: false, confidence: "high", source: "image" },
      spotColourNames: { value: [], confidence: "high", source: "image" },
      fonts: { value: [], confidence: "high", source: "n/a" },
      rasterImages: { value: [], confidence: "high", source: "image" },
      imageWidthPx: { value: 1200, confidence: "high", source: "image" },
      imageHeightPx: { value: 800, confidence: "high", source: "image" },
    },
    sizeComparison: {
      quotedWidthMm: 1200,
      quotedHeightMm: 800,
      detectedWidthMm: 1200,
      detectedHeightMm: 800,
      matchedScale: 1,
      matchedScaleLabel: "100%",
      aspectRatioMatches: true,
      rotationMatches: true,
      expectedFinishedWidthMm: 1200,
      expectedFinishedHeightMm: 800,
      message: "Match at 100%",
    },
    quotedItems: [
      {
        id: "item-1",
        itemReference: "J-4-01",
        itemName: "Window vinyl",
        description: null,
        quantity: 1,
        quotedWidthMm: 1200,
        quotedHeightMm: 800,
        material: "Monomeric vinyl",
        printSpecification: "Monomeric vinyl",
        sides: null,
        finishing: null,
        notes: null,
      },
    ],
    sourceReference: {
      dropboxPath: "/proof.png",
      fileName: "proof.png",
      fileSizeBytes: MINIMAL_PNG.length,
      mimeType: "image/png",
    },
    ...overrides,
  };
}

describe("generateCustomerProofPdf", () => {
  it("generates a PDF with warning/pass lines and apostrophe project names", async () => {
    const pdf = await generateCustomerProofPdf({
      jobReference: "J-4",
      projectName: "O\u2019Malley \u2013 Summer Campaign",
      proofReference: "J-4 Proof v1",
      versionNumber: 1,
      customerMessage: "Please confirm the 1200 \u00D7 800mm size.",
      preflight: buildPreflight(),
      sourceBuffer: MINIMAL_PNG,
    });

    assert.ok(pdf.byteLength > 1000);
    assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  });
});
