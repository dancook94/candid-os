import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument, rgb } from "pdf-lib";

import { embedArtworkPreview } from "@/lib/proof-generator/artwork-preview";
import { generateCustomerProofPdf } from "@/lib/proof-generator/generate-proof-pdf";
import { rasterizePdfPageToPng } from "@/lib/proof-generator/rasterize-pdf-page";
import type { PreflightResult } from "@/lib/proof-generator/types";
import { validateGeneratedProofPdf } from "@/lib/proof-generator/validate-proof-pdf";

async function buildTwoPageColourPdfBuffer() {
  const doc = await PDFDocument.create();

  const redPage = doc.addPage([120, 120]);
  redPage.drawRectangle({
    x: 0,
    y: 0,
    width: 120,
    height: 120,
    color: rgb(1, 0, 0),
  });

  const bluePage = doc.addPage([120, 120]);
  bluePage.drawRectangle({
    x: 0,
    y: 0,
    width: 120,
    height: 120,
    color: rgb(0, 0, 1),
  });

  return Buffer.from(await doc.save());
}

function sampleCenterRgba(rgba: Uint8ClampedArray, widthPx: number, heightPx: number) {
  const x = Math.floor(widthPx / 2);
  const y = Math.floor(heightPx / 2);
  const index = (y * widthPx + x) * 4;
  return {
    r: rgba[index],
    g: rgba[index + 1],
    b: rgba[index + 2],
  };
}

function buildMultiPagePreflight(sourceBuffer: Buffer): PreflightResult {
  return {
    analysisVersion: "phase1",
    overallStatus: "pass",
    checks: [
      {
        key: "colour_mode",
        label: "Colour mode",
        status: "pass",
        detectedValue: "RGB",
        expectedValue: "RGB",
        message: "RGB content detected",
        confidence: "high",
      },
    ],
    metadata: {
      fileName: "two-page.pdf",
      fileSizeBytes: sourceBuffer.length,
      mimeType: "application/pdf",
      inputType: "pdf",
      pageCount: 2,
      pdfVersion: { value: "1.7", confidence: "high", source: "test" },
      pageSize: {
        value: { widthPt: 120, heightPt: 120, widthMm: 42.33, heightMm: 42.33 },
        confidence: "high",
        source: "test",
      },
      orientation: { value: "landscape", confidence: "high", source: "test" },
      mediaBox: { value: null, confidence: "low", source: "n/a" },
      cropBox: { value: null, confidence: "low", source: "n/a" },
      trimBox: { value: null, confidence: "low", source: "n/a" },
      bleedBox: { value: null, confidence: "low", source: "n/a" },
      artBox: { value: null, confidence: "low", source: "n/a" },
      finishedSize: {
        value: { widthPt: 120, heightPt: 120, widthMm: 42.33, heightMm: 42.33 },
        confidence: "high",
        source: "test",
      },
      finishedSizeSource: { value: "media_box", confidence: "high", source: "test" },
      bleedAllowanceMm: { value: null, confidence: "low", source: "n/a" },
      colourMode: { value: "RGB", confidence: "high", source: "test" },
      cmykPresent: { value: false, confidence: "high", source: "test" },
      rgbPresent: { value: true, confidence: "high", source: "test" },
      grayscalePresent: { value: false, confidence: "high", source: "test" },
      spotColourNames: { value: [], confidence: "high", source: "test" },
      fonts: { value: [], confidence: "high", source: "test" },
      rasterImages: { value: [], confidence: "high", source: "test" },
      imageWidthPx: { value: null, confidence: "low", source: "n/a" },
      imageHeightPx: { value: null, confidence: "low", source: "n/a" },
    },
    sizeComparison: {
      quotedWidthMm: 42,
      quotedHeightMm: 42,
      detectedWidthMm: 42.33,
      detectedHeightMm: 42.33,
      matchedScale: 1,
      matchedScaleLabel: "100%",
      widthScalePercent: 100,
      heightScalePercent: 100,
      aspectRatioMatches: true,
      rotationMatches: false,
      comparisonStatus: "pass",
      expectedFinishedWidthMm: 42,
      expectedFinishedHeightMm: 42,
      artworkResolutionDpi: 300,
      effectiveResolutionDpi: 300,
      message: "Artwork supplied at 100% scale.",
    },
    quotedItems: [],
    sourceReference: {
      dropboxPath: "/two-page.pdf",
      fileName: "two-page.pdf",
      fileSizeBytes: sourceBuffer.length,
      mimeType: "application/pdf",
    },
    productionFeatures: {
      cutPathCandidates: [],
      whiteInkCandidates: [],
      layers: [],
      spotColourGroups: { productionSeparations: [], otherSpotColours: [] },
      expectsCutPath: false,
      cutPathOverlayAvailable: false,
      cutPathOverlayReason: null,
    },
    fonts: {
      status: "unknown",
      names: [],
      confidence: "low",
      message: "No live fonts required for vector fill test PDF.",
    },
    images: {
      count: 0,
      linkStatus: "embedded",
      missingLinks: [],
      confidence: "high",
      message: "Vector PDF.",
    },
  };
}

describe("multi-page artwork preview", () => {
  it("rasterizes pageIndex 0 and 1 from a 2-page PDF", async () => {
    const startedAt = Date.now();
    const sourceBuffer = await buildTwoPageColourPdfBuffer();

    const page0 = await rasterizePdfPageToPng(sourceBuffer, 0);
    const page1 = await rasterizePdfPageToPng(sourceBuffer, 1);

    const center0 = sampleCenterRgba(page0.rgbaData, page0.widthPx, page0.heightPx);
    const center1 = sampleCenterRgba(page1.rgbaData, page1.widthPx, page1.heightPx);

    assert.ok(center0.r > center0.b, `page 0 should be red-dominant, got ${JSON.stringify(center0)}`);
    assert.ok(center1.b > center1.r, `page 1 should be blue-dominant, got ${JSON.stringify(center1)}`);

    const durationMs = Date.now() - startedAt;
    assert.ok(durationMs < 30_000, `preview test took ${durationMs}ms`);
  });

  it("embedArtworkPreview honours pageIndex for PDF rasterisation", async () => {
    const startedAt = Date.now();
    const sourceBuffer = await buildTwoPageColourPdfBuffer();
    const targetDoc = await PDFDocument.create();

    const preview0 = await embedArtworkPreview(targetDoc, sourceBuffer, "two-page.pdf", {
      pageIndex: 0,
      rasterizePdf: true,
    });
    const preview1 = await embedArtworkPreview(targetDoc, sourceBuffer, "two-page.pdf", {
      pageIndex: 1,
      rasterizePdf: true,
    });

    assert.equal(preview0.previewMethod, "pdf_raster_png");
    assert.equal(preview1.previewMethod, "pdf_raster_png");
    assert.ok(preview0.sourceWidthPt > 0);
    assert.ok(preview1.sourceWidthPt > 0);
    assert.equal(preview0.sourceWidthPt, preview1.sourceWidthPt);

    const durationMs = Date.now() - startedAt;
    assert.ok(durationMs < 30_000, `embed preview test took ${durationMs}ms`);
  });
});

describe("multi-page branded proof PDF", () => {
  it("renders one artwork page per source PDF page before spec pages", async () => {
    const startedAt = Date.now();
    const sourceBuffer = await buildTwoPageColourPdfBuffer();
    const preflight = buildMultiPagePreflight(sourceBuffer);

    const pdf = await generateCustomerProofPdf({
      jobReference: "MP-1",
      projectName: "Two Page Artwork",
      proofReference: "MP-1 Proof v1",
      versionNumber: 1,
      preflight,
      sourceBuffer,
      sourceFileName: "two-page.pdf",
    });

    const validation = await validateGeneratedProofPdf(pdf);
    assert.equal(validation.ok, true);
    if (!validation.ok) {
      return;
    }

    assert.ok(validation.pageCount >= 3, `expected >= 3 pages, got ${validation.pageCount}`);

    const document = await PDFDocument.load(pdf);
    assert.equal(document.getPageCount(), validation.pageCount);

    const durationMs = Date.now() - startedAt;
    assert.ok(durationMs < 30_000, `branded PDF test took ${durationMs}ms`);
  });
});
