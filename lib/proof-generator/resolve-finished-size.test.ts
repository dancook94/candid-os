import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareArtworkToQuotedSize } from "@/lib/proof-generator/compare-specification";
import { computeCutPathBounds } from "@/lib/proof-generator/cut-path-bounds";
import {
  buildContourCutTestPdfBuffer,
  buildScaledContourCutTestPdfBuffer,
  buildTrimBoxTestPdfBuffer,
  buildTrimOnlyTestPdfBuffer,
} from "@/lib/proof-generator/cut-path-test-pdfs";
import {
  cutPathGeometryHasContent,
  extractCutPathGeometry,
} from "@/lib/proof-generator/extract-cut-path-geometry";
import { analysePdfBuffer } from "@/lib/proof-generator/analyse-pdf";
import { enrichMetadataWithResolvedGeometry } from "@/lib/proof-generator/resolve-pdf-geometry";
import {
  applyAuthoritativeFinishedSizeToPreflight,
  resolveAuthoritativeFinishedSize,
} from "@/lib/proof-generator/resolve-finished-size";
import type { DetectedArtworkMetadata, PreflightResult, ProductionFeaturesResult } from "@/lib/proof-generator/types";

function baseMetadata(overrides: Partial<DetectedArtworkMetadata> = {}): DetectedArtworkMetadata {
  return {
    fileName: "artwork.pdf",
    fileSizeBytes: 1000,
    mimeType: "application/pdf",
    inputType: "pdf",
    pageCount: 1,
    pdfVersion: { value: "1.4", confidence: "high", source: "pdf" },
    pageSize: { value: null, confidence: "low", source: "pdf" },
    orientation: { value: "square", confidence: "high", source: "pdf" },
    mediaBox: { value: null, confidence: "low", source: "pdf" },
    cropBox: { value: null, confidence: "low", source: "pdf" },
    trimBox: { value: null, confidence: "low", source: "pdf" },
    bleedBox: { value: null, confidence: "low", source: "pdf" },
    artBox: { value: null, confidence: "low", source: "pdf" },
    finishedSize: { value: null, confidence: "low", source: "pdf" },
    finishedSizeSource: { value: null, confidence: "low", source: "pdf" },
    bleedAllowanceMm: { value: null, confidence: "low", source: "pdf" },
    colourMode: { value: "CMYK", confidence: "high", source: "pdf" },
    cmykPresent: { value: true, confidence: "high", source: "pdf" },
    rgbPresent: { value: false, confidence: "high", source: "pdf" },
    grayscalePresent: { value: false, confidence: "high", source: "pdf" },
    spotColourNames: { value: ["CutContour"], confidence: "high", source: "pdf" },
    fonts: { value: [], confidence: "high", source: "pdf" },
    rasterImages: { value: [], confidence: "high", source: "pdf" },
    imageWidthPx: { value: null, confidence: "low", source: "pdf" },
    imageHeightPx: { value: null, confidence: "low", source: "pdf" },
    ...overrides,
  };
}

function baseProductionFeatures(
  overrides: Partial<ProductionFeaturesResult> = {}
): ProductionFeaturesResult {
  return {
    cutPathCandidates: [],
    whiteInkCandidates: [],
    layers: [],
    spotColourGroups: { productionSeparations: [], otherSpotColours: [] },
    expectsCutPath: false,
    cutPathOverlayAvailable: false,
    ...overrides,
  };
}

function basePreflight(overrides: Partial<PreflightResult> = {}): PreflightResult {
  return {
    analysisVersion: "2.0.0",
    overallStatus: "pass",
    checks: [],
    metadata: baseMetadata(),
    sizeComparison: null,
    quotedItems: [
      {
        id: "item-1",
        itemReference: "J-4-01",
        itemName: "Foamex Panel",
        description: null,
        quantity: 1,
        quotedWidthMm: 400,
        quotedHeightMm: 400,
        material: "Foamex",
        printSpecification: null,
        sides: null,
        finishing: "Contour cut",
        notes: null,
      },
    ],
    productionFeatures: baseProductionFeatures(),
    fonts: { status: "all_outlined", names: [], confidence: "high", message: "All outlined" },
    images: { count: 0, linkStatus: "embedded", missingLinks: [], confidence: "high", message: "None" },
    sourceReference: {
      dropboxPath: "/art.pdf",
      fileName: "art.pdf",
      fileSizeBytes: 1000,
      mimeType: "application/pdf",
    },
    ...overrides,
  };
}

describe("computeCutPathBounds", () => {
  it("A: measures a 400 x 400 mm circle on a 500 x 500 mm trim artboard", async () => {
    const buffer = buildContourCutTestPdfBuffer({ shape: "circle", cutWidthMm: 400, cutHeightMm: 400 });
    const extraction = await extractCutPathGeometry(buffer, "CutContour", 0);
    assert.equal(extraction.ok, true);
    if (!extraction.ok) {
      return;
    }

    const bounds = computeCutPathBounds(extraction.geometry);
    assert.ok(bounds);
    assert.ok(Math.abs(bounds.widthMm - 400) < 2, `expected ~400mm width, got ${bounds.widthMm}`);
    assert.ok(Math.abs(bounds.heightMm - 400) < 2, `expected ~400mm height, got ${bounds.heightMm}`);
    assert.equal(bounds.overallShape, "circle");
  });

  it("C: measures irregular cut path extents near 420 x 360 mm", async () => {
    const buffer = buildContourCutTestPdfBuffer({
      shape: "irregular",
      cutWidthMm: 420,
      cutHeightMm: 360,
    });
    const extraction = await extractCutPathGeometry(buffer, "CutContour", 0);
    assert.equal(extraction.ok, true);
    if (!extraction.ok) {
      return;
    }

    const bounds = computeCutPathBounds(extraction.geometry);
    assert.ok(bounds);
    assert.ok(Math.abs(bounds.widthMm - 420) < 5, `expected ~420mm width, got ${bounds.widthMm}`);
    assert.ok(Math.abs(bounds.heightMm - 360) < 5, `expected ~360mm height, got ${bounds.heightMm}`);
    assert.equal(bounds.overallShape, "custom_contour");
  });
});

describe("resolveAuthoritativeFinishedSize", () => {
  it("A: uses cut-path bounds as finished production size for confirmed CutContour", async () => {
    const buffer = buildContourCutTestPdfBuffer();
    const metadata = enrichMetadataWithResolvedGeometry(baseMetadata(), buffer);

    const resolved = await resolveAuthoritativeFinishedSize({
      metadata,
      productionFeatures: baseProductionFeatures({
        confirmedCutPath: {
          name: "CutContour",
          sourceType: "separation",
          confirmedAt: "2026-01-01",
          confirmedByProfileId: "user-1",
        },
      }),
      sourceBuffer: buffer,
    });

    assert.equal(resolved.finishedSizeSource, "cut_path");
    assert.ok(resolved.finishedSize);
    assert.ok(Math.abs(resolved.finishedSize.widthMm - 400) < 2);
    assert.ok(Math.abs(resolved.finishedSize.heightMm - 400) < 2);
    assert.equal(resolved.requiresManualReview, false);
  });

  it("B: uses trim size when no cut line is required", async () => {
    const buffer = buildTrimBoxTestPdfBuffer();
    const metadata = await analysePdfBuffer(buffer, "trim-test.pdf", "application/pdf");

    const resolved = await resolveAuthoritativeFinishedSize({
      metadata,
      productionFeatures: baseProductionFeatures({ noCutLineRequired: true }),
      sourceBuffer: buffer,
    });

    assert.equal(resolved.finishedSizeSource, "trim_box");
    assert.ok(resolved.finishedSize);
    assert.ok(Math.abs(resolved.finishedSize.widthMm - 500) < 0.1);
    assert.ok(Math.abs(resolved.finishedSize.heightMm - 500) < 0.1);
    assert.equal(resolved.cutPathSize, null);
  });

  it("D: compares quoted 400 x 400 against 40 x 40 mm cut path at 10% scale", async () => {
    const buffer = buildScaledContourCutTestPdfBuffer();
    const metadata = enrichMetadataWithResolvedGeometry(baseMetadata(), buffer);

    const resolved = await resolveAuthoritativeFinishedSize({
      metadata,
      productionFeatures: baseProductionFeatures({
        confirmedCutPath: {
          name: "CutContour",
          sourceType: "separation",
          confirmedAt: "2026-01-01",
          confirmedByProfileId: "user-1",
        },
      }),
      sourceBuffer: buffer,
    });

    const comparison = compareArtworkToQuotedSize({
      quotedWidthMm: 400,
      quotedHeightMm: 400,
      detectedWidthMm: resolved.finishedSize?.widthMm ?? null,
      detectedHeightMm: resolved.finishedSize?.heightMm ?? null,
      finishedSizeSource: resolved.finishedSizeSource,
    });

    assert.equal(comparison.comparisonStatus, "pass");
    assert.equal(comparison.matchedScaleLabel, "10%");
    assert.match(comparison.message, /Cut path supplied at 10% scale/i);
  });

  it("E: requires manual review when CutContour is confirmed but geometry cannot be extracted", async () => {
    const buffer = buildTrimOnlyTestPdfBuffer();
    const metadata = await analysePdfBuffer(buffer, "trim-only.pdf", "application/pdf");

    const resolved = await resolveAuthoritativeFinishedSize({
      metadata,
      productionFeatures: baseProductionFeatures({
        confirmedCutPath: {
          name: "CutContour",
          sourceType: "separation",
          confirmedAt: "2026-01-01",
          confirmedByProfileId: "user-1",
        },
      }),
      sourceBuffer: buffer,
    });

    assert.equal(resolved.finishedSizeSource, "manual_review");
    assert.equal(resolved.finishedSize, null);
    assert.equal(resolved.cutPathSize, null);
    assert.equal(resolved.requiresManualReview, true);
    assert.ok(metadata.trimBox.value);
    assert.ok((metadata.trimBox.value?.widthMm ?? 0) > 400);
  });
});

describe("applyAuthoritativeFinishedSizeToPreflight", () => {
  it("passes size comparison when artboard is 500 mm but cut path is 400 mm", async () => {
    const buffer = buildContourCutTestPdfBuffer();
    const metadata = enrichMetadataWithResolvedGeometry(baseMetadata(), buffer);
    const preflight = basePreflight({
      metadata,
      productionFeatures: baseProductionFeatures({
        confirmedCutPath: {
          name: "CutContour",
          sourceType: "separation",
          confirmedAt: "2026-01-01",
          confirmedByProfileId: "user-1",
        },
        cutPathSizeExtractable: true,
      }),
    });

    const updated = await applyAuthoritativeFinishedSizeToPreflight(preflight, buffer);

    assert.equal(updated.sizeComparison?.comparisonStatus, "pass");
    assert.equal(updated.metadata.finishedSizeSource.value, "cut_path");
    assert.ok(updated.productionFeatures.cutPathSize);
    assert.ok(Math.abs((updated.productionFeatures.cutPathSize?.widthMm ?? 0) - 400) < 2);
  });
});

describe("cut path extraction guard", () => {
  it("does not treat missing cut geometry as extractable content", async () => {
    const buffer = buildTrimOnlyTestPdfBuffer();
    const extraction = await extractCutPathGeometry(buffer, "CutContour", 0);
    assert.equal(extraction.ok, false);
    if (extraction.ok) {
      assert.equal(cutPathGeometryHasContent(extraction.geometry), false);
    }
  });
});
