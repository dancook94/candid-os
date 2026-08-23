import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatCustomerFontLabel,
  formatCustomerSpotColoursLabel,
  formatProductionFeaturesForCustomerProof,
  formatPdfDimensionsLabel,
  formatPreflightCheckLine,
  formatProofFieldValue,
  PDF_NONE_DETECTED,
  PDF_NOT_SPECIFIED,
  sanitizePdfText,
  statusPrefixForCheck,
} from "@/lib/proof-generator/pdf-text";
import type { PreflightResult } from "@/lib/proof-generator/types";

describe("sanitizePdfText", () => {
  it("converts smart apostrophes in customer names", () => {
    assert.equal(sanitizePdfText("O'Brien Signs"), "O'Brien Signs");
    assert.equal(sanitizePdfText("O\u2019Brien Signs"), "O'Brien Signs");
  });

  it("converts smart quotes and dashes", () => {
    assert.equal(
      sanitizePdfText("\u201CProof\u201D \u2014 approved"),
      '"Proof" - approved'
    );
  });

  it("converts multiplication and middle dot dimensions", () => {
    assert.equal(sanitizePdfText("1200 \u00D7 800mm"), "1200 x 800mm");
    assert.equal(sanitizePdfText("Item A \u00B7 Item B"), "Item A  |  Item B");
  });

  it("replaces unsupported symbols with ASCII fallbacks", () => {
    assert.equal(sanitizePdfText("\u26A0 RGB content detected"), "WARNING RGB content detected");
    assert.equal(sanitizePdfText("\u2713 Size matches"), "PASS Size matches");
    assert.equal(sanitizePdfText("Step 1 \u2192 Step 2"), "Step 1 -> Step 2");
    assert.equal(sanitizePdfText("\u2022 Bullet item"), "- Bullet item");
  });
});

describe("statusPrefixForCheck", () => {
  it("uses ASCII status prefixes for preflight lines", () => {
    assert.equal(statusPrefixForCheck("pass"), "PASS");
    assert.equal(statusPrefixForCheck("warning"), "WARNING");
    assert.equal(statusPrefixForCheck("manual_review"), "REVIEW");
    assert.equal(statusPrefixForCheck("fail"), "FAIL");
  });
});

describe("formatPreflightCheckLine", () => {
  it("formats warning and pass lines for PDF output", () => {
    assert.equal(
      formatPreflightCheckLine({
        status: "warning",
        label: "Colour mode",
        message: "RGB content detected",
      }),
      "WARNING - Colour mode: RGB content detected"
    );

    assert.equal(
      formatPreflightCheckLine({
        status: "pass",
        label: "Size / scale",
        message: "Artwork dimensions match quoted specification",
      }),
      "PASS - Size / scale: Artwork dimensions match quoted specification"
    );
  });
});

describe("formatPdfDimensionsLabel", () => {
  it("uses x instead of multiplication sign", () => {
    assert.equal(formatPdfDimensionsLabel(1200, 800), "1200 x 800 mm");
  });

  it("returns Not specified when dimensions are missing", () => {
    assert.equal(formatPdfDimensionsLabel(null, 800), PDF_NOT_SPECIFIED);
  });
});

describe("formatProofFieldValue", () => {
  it("returns Not specified for empty values", () => {
    assert.equal(formatProofFieldValue(null), PDF_NOT_SPECIFIED);
    assert.equal(formatProofFieldValue("  "), PDF_NOT_SPECIFIED);
  });
});

function samplePreflight(overrides?: Partial<PreflightResult>): PreflightResult {
  return {
    analysisVersion: "2.0.0",
    overallStatus: "warning",
    checks: [
      {
        key: "live_fonts",
        label: "Live fonts",
        status: "warning",
        detectedValue: "OTUBJQ+MyriadPro-Regular",
        expectedValue: null,
        message: "Live fonts detected",
        confidence: "medium",
      },
    ],
    metadata: {
      fileName: "artwork.pdf",
      fileSizeBytes: 1000,
      mimeType: "application/pdf",
      inputType: "pdf",
      pageCount: 1,
      pdfVersion: { value: "1.4", confidence: "high", source: "test" },
      pageSize: {
        value: { widthPt: 100, heightPt: 100, widthMm: 35, heightMm: 35 },
        confidence: "high",
        source: "test",
      },
      orientation: { value: "square", confidence: "high", source: "test" },
      mediaBox: { value: null, confidence: "low", source: "test" },
      cropBox: { value: null, confidence: "low", source: "test" },
      trimBox: { value: null, confidence: "low", source: "test" },
      bleedBox: { value: null, confidence: "low", source: "test" },
      artBox: { value: null, confidence: "low", source: "test" },
      colourMode: { value: "CMYK", confidence: "medium", source: "test" },
      cmykPresent: { value: true, confidence: "medium", source: "test" },
      rgbPresent: { value: false, confidence: "medium", source: "test" },
      grayscalePresent: { value: false, confidence: "medium", source: "test" },
      spotColourNames: { value: ["All", "CutContour"], confidence: "medium", source: "test" },
      fonts: { value: ["OTUBJQ+MyriadPro-Regular"], confidence: "medium", source: "test" },
      rasterImages: { value: [], confidence: "low", source: "test" },
      imageWidthPx: { value: null, confidence: "low", source: "test" },
      imageHeightPx: { value: null, confidence: "low", source: "test" },
    },
    sizeComparison: null,
    quotedItems: [],
    productionFeatures: {
      cutPathCandidates: [],
      whiteInkCandidates: [],
      layers: [],
      spotColourGroups: {
        productionSeparations: ["CutContour"],
        otherSpotColours: ["All"],
      },
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
    images: {
      count: 0,
      linkStatus: "embedded",
      missingLinks: [],
      confidence: "medium",
      message: "Embedded",
    },
    sourceReference: {
      dropboxPath: "/artwork.pdf",
      fileName: "artwork.pdf",
      fileSizeBytes: 1000,
      mimeType: "application/pdf",
    },
    ...overrides,
  };
}

describe("customer-facing preflight labels", () => {
  it("filters noise spot names and keeps printable spots separate from production separations", () => {
    assert.equal(formatCustomerSpotColoursLabel(samplePreflight()), PDF_NONE_DETECTED);
  });

  it("shows simplified live font wording for customer proofs", () => {
    assert.equal(
      formatCustomerFontLabel(samplePreflight()),
      "Live text detected — Candid review required"
    );
  });

  it("shows cut path preview status on production features rows", () => {
    const rendered = formatProductionFeaturesForCustomerProof(
      samplePreflight({
        productionFeatures: {
          ...samplePreflight().productionFeatures,
          showCutPathOnProof: true,
          cutPathOverlayRendered: true,
        },
      })
    );

    assert.equal(
      rendered.find((row) => row.label === "Cut path preview")?.value,
      "Shown on artwork"
    );

    const failed = formatProductionFeaturesForCustomerProof(
      samplePreflight({
        productionFeatures: {
          ...samplePreflight().productionFeatures,
          showCutPathOnProof: true,
          cutPathOverlayRendered: false,
        },
      })
    );

    assert.equal(
      failed.find((row) => row.label === "Cut path preview")?.value,
      "Unable to render — Candid review required"
    );
  });
});
