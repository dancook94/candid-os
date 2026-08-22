import {
  COMMON_ARTWORK_SCALES,
  SIZE_MATCH_TOLERANCE_MM,
} from "@/lib/proof-generator/constants";
import type { SizeComparisonResult } from "@/lib/proof-generator/types";

function withinTolerance(actual: number, expected: number) {
  return Math.abs(actual - expected) <= SIZE_MATCH_TOLERANCE_MM;
}

function aspectRatioMatches(
  widthA: number,
  heightA: number,
  widthB: number,
  heightB: number
) {
  const ratioA = widthA / heightA;
  const ratioB = widthB / heightB;
  return Math.abs(ratioA - ratioB) <= 0.02;
}

export function compareArtworkToQuotedSize(input: {
  quotedWidthMm: number | null;
  quotedHeightMm: number | null;
  detectedWidthMm: number | null;
  detectedHeightMm: number | null;
}): SizeComparisonResult {
  const {
    quotedWidthMm,
    quotedHeightMm,
    detectedWidthMm,
    detectedHeightMm,
  } = input;

  const base: SizeComparisonResult = {
    quotedWidthMm,
    quotedHeightMm,
    detectedWidthMm,
    detectedHeightMm,
    matchedScale: null,
    matchedScaleLabel: null,
    aspectRatioMatches: false,
    rotationMatches: false,
    expectedFinishedWidthMm: null,
    expectedFinishedHeightMm: null,
    message: "Quoted finished dimensions are not available for comparison.",
  };

  if (
    quotedWidthMm == null ||
    quotedHeightMm == null ||
    detectedWidthMm == null ||
    detectedHeightMm == null
  ) {
    return {
      ...base,
      message: "Size comparison requires quoted and detected dimensions.",
    };
  }

  for (const scale of COMMON_ARTWORK_SCALES) {
    const expectedWidth = quotedWidthMm * scale;
    const expectedHeight = quotedHeightMm * scale;

    const directMatch =
      withinTolerance(detectedWidthMm, expectedWidth) &&
      withinTolerance(detectedHeightMm, expectedHeight);

    const rotatedMatch =
      withinTolerance(detectedWidthMm, expectedHeight) &&
      withinTolerance(detectedHeightMm, expectedWidth);

    if (directMatch || rotatedMatch) {
      const scaleLabel =
        scale === 1 ? "100%" : `${Math.round(scale * 1000) / 10}%`;

      return {
        quotedWidthMm,
        quotedHeightMm,
        detectedWidthMm,
        detectedHeightMm,
        matchedScale: scale,
        matchedScaleLabel: scaleLabel,
        aspectRatioMatches: true,
        rotationMatches: rotatedMatch && !directMatch,
        expectedFinishedWidthMm: quotedWidthMm,
        expectedFinishedHeightMm: quotedHeightMm,
        message: rotatedMatch && !directMatch
          ? `Artwork dimensions match quoted specification at ${scaleLabel} scale when rotated. Expected output size: ${quotedWidthMm} × ${quotedHeightMm} mm.`
          : `Artwork supplied at ${scaleLabel} scale. Expected output size: ${quotedWidthMm} × ${quotedHeightMm} mm.`,
      };
    }
  }

  const aspectOk =
    aspectRatioMatches(
      detectedWidthMm,
      detectedHeightMm,
      quotedWidthMm,
      quotedHeightMm
    ) ||
    aspectRatioMatches(
      detectedWidthMm,
      detectedHeightMm,
      quotedHeightMm,
      quotedWidthMm
    );

  return {
    quotedWidthMm,
    quotedHeightMm,
    detectedWidthMm,
    detectedHeightMm,
    matchedScale: null,
    matchedScaleLabel: null,
    aspectRatioMatches: aspectOk,
    rotationMatches: aspectOk &&
      aspectRatioMatches(
        detectedWidthMm,
        detectedHeightMm,
        quotedHeightMm,
        quotedWidthMm
      ),
    expectedFinishedWidthMm: null,
    expectedFinishedHeightMm: null,
    message: aspectOk
      ? "Aspect ratio matches quoted specification, but artwork scale does not match common production scales."
      : "Artwork size does not match quoted specification.",
  };
}

export function computeEffectiveDpi(input: {
  widthPx: number;
  heightPx: number;
  artworkWidthMm: number;
  artworkHeightMm: number;
  finishedScale: number | null;
}) {
  if (
    input.artworkWidthMm <= 0 ||
    input.artworkHeightMm <= 0 ||
    input.finishedScale == null ||
    input.finishedScale <= 0
  ) {
    return null;
  }

  const finishedWidthMm = input.artworkWidthMm / input.finishedScale;
  const finishedHeightMm = input.artworkHeightMm / input.finishedScale;
  const widthInches = finishedWidthMm / 25.4;
  const heightInches = finishedHeightMm / 25.4;

  const dpiWidth = input.widthPx / widthInches;
  const dpiHeight = input.heightPx / heightInches;

  return Math.round(Math.min(dpiWidth, dpiHeight));
}
