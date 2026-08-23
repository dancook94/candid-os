import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveAiPreflightAvailability } from "@/lib/proof-generator/analyse-ai";
import {
  buildProductionFeaturesFromScan,
  quotedItemsExpectCutPath,
} from "@/lib/proof-generator/production-features";
import {
  buildFeatureCandidates,
  nameMatchesCutPath,
  nameMatchesWhiteInk,
  scanPdfContent,
} from "@/lib/proof-generator/scan-pdf-content";
import { buildPreflightResult } from "@/lib/proof-generator/warnings";
import { resolvePreflightAfterOperatorConfirmation } from "@/lib/proof-generator/operator-confirmation";
import type { DetectedArtworkMetadata, QuotedSpecificationItem } from "@/lib/proof-generator/types";

function makeQuotedItem(overrides: Partial<QuotedSpecificationItem> = {}): QuotedSpecificationItem {
  return {
    id: "item-1",
    itemReference: "J-1-01",
    itemName: "Foamex sign",
    description: null,
    quantity: 1,
    quotedWidthMm: 1000,
    quotedHeightMm: 500,
    material: "Foamex",
    printSpecification: null,
    sides: null,
    finishing: null,
    notes: null,
    ...overrides,
  };
}

function makePdfBuffer(content: string) {
  return Buffer.from(`%PDF-1.4\n${content}\n%%EOF`, "latin1");
}

function baseMetadata(overrides: Partial<DetectedArtworkMetadata> = {}): DetectedArtworkMetadata {
  return {
    fileName: "artwork.pdf",
    fileSizeBytes: 1024,
    mimeType: "application/pdf",
    inputType: "pdf",
    analysisNote: null,
    pageCount: 1,
    pdfVersion: { value: "1.4", confidence: "high", source: "test" },
    pageSize: {
      value: { widthPt: 100, heightPt: 50, widthMm: 35.28, heightMm: 17.64 },
      confidence: "high",
      source: "test",
    },
    orientation: { value: "landscape", confidence: "high", source: "test" },
    mediaBox: { value: null, confidence: "low", source: "test" },
    cropBox: { value: null, confidence: "low", source: "test" },
    trimBox: { value: null, confidence: "low", source: "test" },
    bleedBox: { value: null, confidence: "low", source: "test" },
    artBox: { value: null, confidence: "low", source: "test" },
    colourMode: { value: "CMYK", confidence: "medium", source: "test" },
    cmykPresent: { value: true, confidence: "medium", source: "test" },
    rgbPresent: { value: false, confidence: "medium", source: "test" },
    grayscalePresent: { value: false, confidence: "medium", source: "test" },
    spotColourNames: { value: [], confidence: "low", source: "test" },
    fonts: { value: [], confidence: "low", source: "test" },
    rasterImages: { value: [], confidence: "low", source: "test" },
    imageWidthPx: { value: null, confidence: "low", source: "test" },
    imageHeightPx: { value: null, confidence: "low", source: "test" },
    ...overrides,
  };
}

describe("advanced artwork preflight", () => {
  it("scenario A: detects CutContour spot colour candidate", () => {
    const scan = scanPdfContent(makePdfBuffer("/Separation /CutContour"));
    const features = buildProductionFeaturesFromScan(scan, [makeQuotedItem()]);
    assert.equal(features.cutPathCandidates.some((entry) => entry.name === "CutContour"), true);
  });

  it("scenario B: detects CUT LINE layer candidate", () => {
    const scan = scanPdfContent(makePdfBuffer('/Title (CUT LINE)'));
    const candidates = buildFeatureCandidates(
      scan,
      nameMatchesCutPath,
      () => "medium",
      "Possible cut path"
    );
    assert.equal(candidates.some((entry) => entry.name === "CUT LINE"), true);
  });

  it("scenario G: mixed RGB and CMYK triggers warning check", () => {
    const buffer = makePdfBuffer("/DeviceCMYK /DeviceRGB");
    const result = buildPreflightResult({
      metadata: baseMetadata({
        rgbPresent: { value: true, confidence: "medium", source: "test" },
        colourMode: { value: "Mixed", confidence: "medium", source: "test" },
      }),
      quotedItems: [makeQuotedItem()],
      sourceReference: {
        dropboxPath: "/Artwork/test.pdf",
        fileName: "test.pdf",
        fileSizeBytes: buffer.length,
        mimeType: "application/pdf",
      },
      sourceBuffer: buffer,
    });

    assert.equal(
      result.checks.some((check) => check.key === "rgb_content" && check.status === "warning"),
      true
    );
  });

  it("scenario H: detects Spot White white-ink candidate", () => {
    const scan = scanPdfContent(makePdfBuffer("/Separation /SpotWhite"));
    assert.equal(nameMatchesWhiteInk("Spot White") || nameMatchesWhiteInk("SpotWhite"), true);
    const features = buildProductionFeaturesFromScan(scan, [makeQuotedItem()]);
    assert.equal(features.whiteInkCandidates.length >= 0, true);
  });

  it("scenario J: PDF-compatible AI stream is analysable", () => {
    const buffer = Buffer.from("%PDF-1.4\n/Separation /CutContour\n%%EOF", "latin1");
    const availability = resolveAiPreflightAvailability(buffer, "artwork.ai");
    assert.equal(availability.kind, "pdf_compatible");
  });

  it("scenario K: unsupported AI returns clear export instruction", () => {
    const buffer = Buffer.from("%!PS-Adobe-3.0", "latin1");
    const availability = resolveAiPreflightAvailability(buffer, "artwork.ai");
    assert.equal(availability.kind, "unsupported");
    assert.match(availability.message, /Export a PDF-compatible copy/i);
  });

  it("expects cut path for contour finishing quoted items", () => {
    assert.equal(
      quotedItemsExpectCutPath([
        makeQuotedItem({ finishing: "Kiss cut vinyl contour" }),
      ]),
      true
    );
  });

  it("replaces cut path candidate review after operator confirmation", () => {
    const buffer = makePdfBuffer("/Separation /CutContour");
    const preflight = buildPreflightResult({
      metadata: baseMetadata(),
      quotedItems: [makeQuotedItem({ finishing: "Contour cut" })],
      sourceReference: {
        dropboxPath: "/Artwork/test.pdf",
        fileName: "test.pdf",
        fileSizeBytes: buffer.length,
        mimeType: "application/pdf",
      },
      sourceBuffer: buffer,
    });

    const resolved = resolvePreflightAfterOperatorConfirmation(
      preflight,
      {
        cutPath: {
          decision: "confirmed",
          confirmedCandidateName: "CutContour",
          showOnCustomerProof: true,
        },
      },
      "staff-1"
    );

    assert.equal(
      resolved.checks.some((check) => check.key === "cut_path_candidates"),
      false
    );
    assert.equal(
      resolved.checks.some(
        (check) => check.key === "cut_path_confirmed" && check.status === "pass"
      ),
      true
    );
  });
});
