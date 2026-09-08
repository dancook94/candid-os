import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateCustomerProofPdf } from "@/lib/proof-generator/generate-proof-pdf";
import { buildJ4LikeArtworkPdfBuffer } from "@/lib/proof-generator/j4-artwork-fixture";
import {
  countDarkPixels,
  rasterizePdfPageToPng,
  validateFlattenedArtworkPreview,
} from "@/lib/proof-generator/rasterize-pdf-page";
import type { PreflightResult } from "@/lib/proof-generator/types";
import { validateGeneratedProofPdf } from "@/lib/proof-generator/validate-proof-pdf";

function buildPreflight(sourceLength: number): PreflightResult {
  return {
    analysisVersion: "2.0.0",
    overallStatus: "pass",
    checks: [],
    metadata: {
      fileName: "artwork.pdf",
      fileSizeBytes: sourceLength,
      mimeType: "application/pdf",
      inputType: "pdf",
      pageCount: 1,
      pdfVersion: { value: "1.4", confidence: "high", source: "test" },
      pageSize: {
        value: { widthPt: 1488, heightPt: 1488, widthMm: 523.28, heightMm: 523.28 },
        confidence: "high",
        source: "test",
      },
      orientation: { value: "square", confidence: "high", source: "test" },
      mediaBox: { value: null, confidence: "low", source: "n/a" },
      cropBox: { value: null, confidence: "low", source: "n/a" },
      trimBox: {
        value: { widthPt: 1417, heightPt: 1417, widthMm: 500, heightMm: 500 },
        confidence: "high",
        source: "test",
      },
      bleedBox: { value: null, confidence: "low", source: "n/a" },
      artBox: { value: null, confidence: "low", source: "n/a" },
      finishedSize: {
        value: { widthPt: 1134, heightPt: 1134, widthMm: 400, heightMm: 400 },
        confidence: "high",
        source: "cut_path",
      },
      finishedSizeSource: { value: "cut_path", confidence: "high", source: "test" },
      bleedAllowanceMm: { value: null, confidence: "low", source: "n/a" },
      colourMode: { value: "CMYK", confidence: "high", source: "test" },
      cmykPresent: { value: true, confidence: "high", source: "test" },
      rgbPresent: { value: false, confidence: "high", source: "test" },
      grayscalePresent: { value: false, confidence: "high", source: "test" },
      spotColourNames: { value: [], confidence: "high", source: "test" },
      fonts: { value: ["Helvetica-Bold"], confidence: "high", source: "test" },
      rasterImages: { value: [], confidence: "high", source: "test" },
      imageWidthPx: { value: null, confidence: "low", source: "n/a" },
      imageHeightPx: { value: null, confidence: "low", source: "n/a" },
    },
    sizeComparison: null,
    quotedItems: [],
    productionFeatures: {
      cutPathCandidates: [],
      whiteInkCandidates: [],
      layers: [],
      spotColourGroups: { productionSeparations: [], otherSpotColours: [] },
      expectsCutPath: false,
      cutPathOverlayAvailable: false,
      showCutPathOnProof: false,
    },
    fonts: { status: "live_fonts_detected", names: ["Helvetica-Bold"], confidence: "high", message: "" },
    images: { count: 0, linkStatus: "unknown", missingLinks: [], confidence: "low", message: "" },
  };
}

describe("J-4 artwork fixture", () => {
  it("generates a branded proof from a flattened render containing Test text", async () => {
    const sourceBuffer = await buildJ4LikeArtworkPdfBuffer();
    const flattened = await rasterizePdfPageToPng(sourceBuffer, 0);
    const flattenedValidation = await validateFlattenedArtworkPreview({
      sourceBuffer,
      pngBuffer: flattened.pngBuffer,
      rgbaData: flattened.rgbaData,
    });

    assert.equal(flattenedValidation.ok, true);
    assert.ok(await countDarkPixels(flattened.pngBuffer) > 250);

    const preflight = buildPreflight(sourceBuffer.length);
    const pdf = await generateCustomerProofPdf({
      jobReference: "J-4",
      projectName: "Foamex Panels",
      proofReference: "J-4 Proof v7",
      versionNumber: 7,
      customerMessage: "Please confirm artwork text is visible.",
      preflight,
      sourceBuffer,
      sourceFileName: "artwork.pdf",
    });

    const validation = await validateGeneratedProofPdf(pdf);
    assert.equal(validation.ok, true);
    assert.equal(preflight.productionFeatures.originalCutPathSuppressed, false);
  });
});
