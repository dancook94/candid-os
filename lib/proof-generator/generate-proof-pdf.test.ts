import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateCustomerProofPdf } from "@/lib/proof-generator/generate-proof-pdf";
import type { PreflightResult } from "@/lib/proof-generator/types";
import { validateGeneratedProofPdf } from "@/lib/proof-generator/validate-proof-pdf";
import { PDFDocument } from "pdf-lib";

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
      finishedSize: {
        value: { widthPt: 0, heightPt: 0, widthMm: 1200, heightMm: 800 },
        confidence: "high",
        source: "image",
      },
      finishedSizeSource: { value: "media_box", confidence: "high", source: "image" },
      bleedAllowanceMm: { value: null, confidence: "low", source: "n/a" },
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
      widthScalePercent: 100,
      heightScalePercent: 100,
      aspectRatioMatches: true,
      rotationMatches: false,
      comparisonStatus: "pass",
      expectedFinishedWidthMm: 1200,
      expectedFinishedHeightMm: 800,
      artworkResolutionDpi: 300,
      effectiveResolutionDpi: 300,
      message: "Artwork supplied at 100% scale.",
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
      message: "Font status could not be determined for raster artwork.",
    },
    images: {
      count: 1,
      linkStatus: "embedded",
      missingLinks: [],
      confidence: "high",
      message: "Image file.",
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
      sourceFileName: "proof.png",
    });

    assert.ok(pdf.byteLength > 1000);
    assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  });

  it("supports additional specification pages for long preflight results", async () => {
    const checks = Array.from({ length: 24 }, (_, index) => ({
      key: `check_${index}`,
      label: `Check ${index + 1}`,
      status: "warning" as const,
      detectedValue: "Value",
      expectedValue: null,
      message: `Detailed review message ${index + 1} for customer approval workflow with additional wrapped content to increase card height.`,
      confidence: "medium" as const,
    }));

    const pdf = await generateCustomerProofPdf({
      jobReference: "J-4",
      projectName: "Long Preflight Job",
      proofReference: "J-4 Proof v1",
      versionNumber: 1,
      preflight: buildPreflight({
        checks,
        productionFeatures: {
          cutPathCandidates: [],
          whiteInkCandidates: [],
          layers: [],
          spotColourGroups: { productionSeparations: ["CutContour"], otherSpotColours: [] },
          expectsCutPath: false,
          cutPathOverlayAvailable: false,
          confirmedCutPath: {
            name: "CutContour",
            sourceType: "separation",
            confirmedAt: "2026-01-01T00:00:00.000Z",
            confirmedByProfileId: "user-1",
          },
        },
        fonts: {
          status: "live_fonts_detected",
          names: ["OTUBJQ+MyriadPro-Regular"],
          confidence: "medium",
          message: "Live fonts detected",
        },
      }),
      sourceBuffer: MINIMAL_PNG,
      sourceFileName: "proof.png",
    });

    const document = await PDFDocument.load(pdf);
    assert.ok(document.getPageCount() >= 3);
  });

  it("renders cut path overlay and legend when show cut path is enabled", async () => {
    const sourceBuffer = (
      await import("@/lib/proof-generator/cut-path-test-pdfs")
    ).buildCutPathTestPdfBuffer({ shape: "rectangle" });

    const withoutOverlay = await generateCustomerProofPdf({
      jobReference: "J-4",
      projectName: "Cut Path Overlay Job",
      proofReference: "J-4 Proof v5",
      versionNumber: 5,
      preflight: buildPreflight({
        metadata: {
          ...buildPreflight().metadata,
          fileName: "artwork.pdf",
          mimeType: "application/pdf",
          inputType: "pdf",
          pageCount: 1,
          pageSize: {
            value: { widthPt: 200, heightPt: 200, widthMm: 70.56, heightMm: 70.56 },
            confidence: "high",
            source: "test",
          },
        },
        productionFeatures: {
          cutPathCandidates: [],
          whiteInkCandidates: [],
          layers: [],
          spotColourGroups: { productionSeparations: ["CutContour"], otherSpotColours: [] },
          expectsCutPath: true,
          cutPathOverlayAvailable: true,
          confirmedCutPath: {
            name: "CutContour",
            sourceType: "separation",
            confirmedAt: "2026-01-01T00:00:00.000Z",
            confirmedByProfileId: "user-1",
          },
          showCutPathOnProof: false,
        },
      }),
      sourceBuffer,
      sourceFileName: "artwork.pdf",
    });

    const withOverlay = await generateCustomerProofPdf({
      jobReference: "J-4",
      projectName: "Cut Path Overlay Job",
      proofReference: "J-4 Proof v5",
      versionNumber: 5,
      preflight: buildPreflight({
        metadata: {
          ...buildPreflight().metadata,
          fileName: "artwork.pdf",
          mimeType: "application/pdf",
          inputType: "pdf",
          pageCount: 1,
          pageSize: {
            value: { widthPt: 200, heightPt: 200, widthMm: 70.56, heightMm: 70.56 },
            confidence: "high",
            source: "test",
          },
        },
        productionFeatures: {
          cutPathCandidates: [
            {
              name: "CutContour",
              sourceType: "separation",
              confidence: "high",
              reason: "Separation name",
            },
          ],
          whiteInkCandidates: [],
          layers: [],
          spotColourGroups: { productionSeparations: ["CutContour"], otherSpotColours: [] },
          expectsCutPath: true,
          cutPathOverlayAvailable: true,
          cutPathOverlayReason: null,
          confirmedCutPath: {
            name: "CutContour",
            sourceType: "separation",
            confirmedAt: "2026-01-01T00:00:00.000Z",
            confirmedByProfileId: "user-1",
          },
          showCutPathOnProof: true,
          cutPathOverlayRendered: false,
        },
      }),
      sourceBuffer,
      sourceFileName: "artwork.pdf",
    });

    assert.ok(withOverlay.byteLength > withoutOverlay.byteLength);
    const document = await PDFDocument.load(withOverlay);
    assert.equal(document.getPageCount(), 2);
  });

  it("renders OCG CutContour overlay with resolved preview flags", async () => {
    const sourceBuffer = (
      await import("@/lib/proof-generator/cut-path-test-pdfs")
    ).buildOcgCutPathPdfBuffer({ shape: "circle" });

    const preflight = buildPreflight({
      metadata: {
        ...buildPreflight().metadata,
        fileName: "artwork.pdf",
        mimeType: "application/pdf",
        inputType: "pdf",
        pageCount: 1,
        pageSize: {
          value: { widthPt: 200, heightPt: 200, widthMm: 70.56, heightMm: 70.56 },
          confidence: "high",
          source: "test",
        },
      },
      productionFeatures: {
        cutPathCandidates: [
          {
            name: "CutContour",
            sourceType: "optional_content_group",
            confidence: "high",
            reason: "Optional Content Group",
          },
        ],
        whiteInkCandidates: [],
        layers: [],
        spotColourGroups: { productionSeparations: [], otherSpotColours: [] },
        expectsCutPath: true,
        cutPathOverlayAvailable: true,
        cutPathOverlayReason: null,
        confirmedCutPath: {
          name: "CutContour",
          sourceType: "optional_content_group",
          confirmedAt: "2026-01-01T00:00:00.000Z",
          confirmedByProfileId: "user-1",
        },
        showCutPathOnProof: true,
      },
    });

    const pdf = await generateCustomerProofPdf({
      jobReference: "J-4",
      projectName: "OCG Cut Path Overlay Job",
      proofReference: "J-4 Proof v6",
      versionNumber: 6,
      preflight,
      sourceBuffer,
      sourceFileName: "artwork.pdf",
    });

    assert.ok(pdf.byteLength > 1000);
    assert.equal(preflight.productionFeatures.cutPathOverlayRendered, true);
    assert.equal(preflight.productionFeatures.cutPathOverlayGeometryAvailable, true);
  });

  it("does not render cut path overlay when show cut path is disabled", async () => {
    const sourceBuffer = (
      await import("@/lib/proof-generator/cut-path-test-pdfs")
    ).buildCutPathTestPdfBuffer({ shape: "rectangle" });

    const pdf = await generateCustomerProofPdf({
      jobReference: "J-4",
      projectName: "Cut Path Hidden Job",
      proofReference: "J-4 Proof v5",
      versionNumber: 5,
      preflight: buildPreflight({
        metadata: {
          ...buildPreflight().metadata,
          fileName: "artwork.pdf",
          mimeType: "application/pdf",
          inputType: "pdf",
          pageCount: 1,
          pageSize: {
            value: { widthPt: 200, heightPt: 200, widthMm: 70.56, heightMm: 70.56 },
            confidence: "high",
            source: "test",
          },
        },
        productionFeatures: {
          cutPathCandidates: [],
          whiteInkCandidates: [],
          layers: [],
          spotColourGroups: { productionSeparations: ["CutContour"], otherSpotColours: [] },
          expectsCutPath: true,
          cutPathOverlayAvailable: true,
          confirmedCutPath: {
            name: "CutContour",
            sourceType: "separation",
            confirmedAt: "2026-01-01T00:00:00.000Z",
            confirmedByProfileId: "user-1",
          },
          showCutPathOnProof: false,
        },
      }),
      sourceBuffer,
      sourceFileName: "artwork.pdf",
    });

    assert.ok(pdf.byteLength > 1000);
  });

  it("preserves artwork and renders cut-line legend for J-4-like contour PDF", async () => {
    const sourceBuffer = (
      await import("@/lib/proof-generator/cut-path-test-pdfs")
    ).buildContourCutTestPdfBuffer({ shape: "circle", cutWidthMm: 400, cutHeightMm: 400 });

    const preflight = buildPreflight({
      metadata: {
        ...buildPreflight().metadata,
        fileName: "artwork.pdf",
        mimeType: "application/pdf",
        inputType: "pdf",
        pageCount: 1,
        pageSize: {
          value: { widthPt: 1488, heightPt: 1488, widthMm: 523.28, heightMm: 523.28 },
          confidence: "high",
          source: "test",
        },
      },
      productionFeatures: {
        cutPathCandidates: [
          {
            name: "CutContour",
            sourceType: "separation",
            confidence: "high",
            reason: "Separation name",
          },
        ],
        whiteInkCandidates: [],
        layers: [],
        spotColourGroups: { productionSeparations: ["CutContour"], otherSpotColours: [] },
        expectsCutPath: true,
        cutPathOverlayAvailable: true,
        cutPathOverlayReason: null,
        confirmedCutPath: {
          name: "CutContour",
          sourceType: "separation",
          confirmedAt: "2026-01-01T00:00:00.000Z",
          confirmedByProfileId: "user-1",
        },
        showCutPathOnProof: true,
        cutPathSize: { widthMm: 400, heightMm: 400, widthPt: 0, heightPt: 0 },
        resolvedProductionFinishedSize: {
          widthMm: 400,
          heightMm: 400,
          widthPt: 0,
          heightPt: 0,
        },
        resolvedProductionFinishedSizeSource: "cut_path",
      },
    });

    const pdf = await generateCustomerProofPdf({
      jobReference: "J-4",
      projectName: "Foamex Panels",
      proofReference: "J-4 Proof v6",
      versionNumber: 6,
      customerMessage: "Foamex Panels Proof v1",
      preflight,
      sourceBuffer,
      sourceFileName: "artwork.pdf",
    });

    assert.ok(pdf.byteLength > 1000);
    assert.equal(preflight.productionFeatures.cutPathOverlayRendered, true);
    assert.equal(preflight.productionFeatures.originalCutPathSuppressed, false);
    assert.equal(
      preflight.checks.some((check) => check.key === "cut_path_candidates"),
      false
    );
    assert.equal(
      preflight.checks.filter((check) => check.key === "cut_path_confirmed").length,
      1
    );
    const cutPathCheck = preflight.checks.find((check) => check.key === "cut_path_confirmed");
    assert.ok(cutPathCheck);
    assert.equal(cutPathCheck?.message, "CutContour confirmed by Candid");

    const validation = await validateGeneratedProofPdf(pdf);
    assert.equal(validation.ok, true);
  });

  it("keeps exactly one cut path PASS when checks were already resolved before PDF generation", async () => {
    const sourceBuffer = (
      await import("@/lib/proof-generator/cut-path-test-pdfs")
    ).buildContourCutTestPdfBuffer({ shape: "circle", cutWidthMm: 400, cutHeightMm: 400 });

    const preflight = buildPreflight({
      checks: [
        {
          key: "cut_path_confirmed",
          label: "Cut path",
          status: "pass",
          detectedValue: "CutContour",
          expectedValue: null,
          message: "CutContour confirmed by Candid",
          confidence: "high",
        },
      ],
      metadata: {
        ...buildPreflight().metadata,
        fileName: "artwork.pdf",
        mimeType: "application/pdf",
        inputType: "pdf",
        pageCount: 1,
      },
      productionFeatures: {
        cutPathCandidates: [],
        whiteInkCandidates: [],
        layers: [],
        spotColourGroups: { productionSeparations: ["CutContour"], otherSpotColours: [] },
        expectsCutPath: true,
        cutPathOverlayAvailable: true,
        confirmedCutPath: {
          name: "CutContour",
          sourceType: "separation",
          confirmedAt: "2026-01-01T00:00:00.000Z",
          confirmedByProfileId: "user-1",
        },
        showCutPathOnProof: true,
        cutPathSize: { widthMm: 400, heightMm: 400, widthPt: 0, heightPt: 0 },
      },
    });

    await generateCustomerProofPdf({
      jobReference: "J-4",
      projectName: "Foamex Panels",
      proofReference: "J-4 Proof v12",
      versionNumber: 12,
      preflight,
      sourceBuffer,
      sourceFileName: "artwork.pdf",
    });

    assert.equal(
      preflight.checks.filter((check) => check.key === "cut_path_confirmed").length,
      1
    );
    assert.equal(preflight.productionFeatures.cutPathOverlayRendered, true);
  });
});
