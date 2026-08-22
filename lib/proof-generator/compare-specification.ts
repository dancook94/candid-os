import {
  COMMON_ARTWORK_SCALES,
  COMMON_SCALE_SNAP_TOLERANCE,
  SCALE_RATIO_TOLERANCE,
} from "@/lib/proof-generator/constants";
import type { SizeComparisonResult } from "@/lib/proof-generator/types";

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

function scalesAgreeWithinTolerance(widthScale: number, heightScale: number) {
  if (widthScale <= 0 || heightScale <= 0) {
    return false;
  }

  const average = (widthScale + heightScale) / 2;
  if (average <= 0) {
    return false;
  }

  return (
    Math.abs(widthScale - heightScale) / average <= SCALE_RATIO_TOLERANCE
  );
}

export function formatScalePercentLabel(scale: number): string {
  const percent = scale * 100;
  const rounded =
    Math.abs(percent - Math.round(percent)) < 0.05
      ? Math.round(percent)
      : Math.round(percent * 10) / 10;

  return `${rounded}%`;
}

function snapToCommonScale(scale: number): number | null {
  for (const commonScale of COMMON_ARTWORK_SCALES) {
    if (Math.abs(scale - commonScale) / commonScale <= COMMON_SCALE_SNAP_TOLERANCE) {
      return commonScale;
    }
  }

  return null;
}

function evaluateOrientation(input: {
  quotedWidthMm: number;
  quotedHeightMm: number;
  detectedWidthMm: number;
  detectedHeightMm: number;
  rotated: boolean;
}) {
  const quotedWidth = input.rotated ? input.quotedHeightMm : input.quotedWidthMm;
  const quotedHeight = input.rotated ? input.quotedWidthMm : input.quotedHeightMm;

  const widthScale = input.detectedWidthMm / quotedWidth;
  const heightScale = input.detectedHeightMm / quotedHeight;

  if (!scalesAgreeWithinTolerance(widthScale, heightScale)) {
    return null;
  }

  const averageScale = (widthScale + heightScale) / 2;
  const commonScale = snapToCommonScale(averageScale);
  const matchedScale = commonScale ?? averageScale;

  return {
    widthScale,
    heightScale,
    matchedScale,
    matchedScaleLabel: formatScalePercentLabel(matchedScale),
    rotationMatches: input.rotated,
  };
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
    widthScalePercent: null,
    heightScalePercent: null,
    aspectRatioMatches: false,
    rotationMatches: false,
    comparisonStatus: "manual_review",
    expectedFinishedWidthMm: null,
    expectedFinishedHeightMm: null,
    artworkResolutionDpi: null,
    effectiveResolutionDpi: null,
    message: "Quoted finished dimensions are not available for comparison.",
  };

  if (
    quotedWidthMm == null ||
    quotedHeightMm == null ||
    detectedWidthMm == null ||
    detectedHeightMm == null ||
    quotedWidthMm <= 0 ||
    quotedHeightMm <= 0 ||
    detectedWidthMm <= 0 ||
    detectedHeightMm <= 0
  ) {
    return {
      ...base,
      message: "Size comparison requires quoted and detected dimensions.",
    };
  }

  const directWidthScale = detectedWidthMm / quotedWidthMm;
  const directHeightScale = detectedHeightMm / quotedHeightMm;

  const directMatch = evaluateOrientation({
    quotedWidthMm,
    quotedHeightMm,
    detectedWidthMm,
    detectedHeightMm,
    rotated: false,
  });

  const rotatedMatch = evaluateOrientation({
    quotedWidthMm,
    quotedHeightMm,
    detectedWidthMm,
    detectedHeightMm,
    rotated: true,
  });

  const scaleMatch = directMatch ?? rotatedMatch;

  if (scaleMatch) {
    const finishedSizeLabel = `${quotedWidthMm} x ${quotedHeightMm} mm`;
    const artworkSizeLabel = `${detectedWidthMm} x ${detectedHeightMm} mm`;

    const message = scaleMatch.rotationMatches
      ? `Artwork supplied at ${scaleMatch.matchedScaleLabel} scale with orientation rotated. Finished size: ${finishedSizeLabel}. Artwork size: ${artworkSizeLabel}. Scale: ${scaleMatch.matchedScaleLabel}.`
      : `Artwork supplied at ${scaleMatch.matchedScaleLabel} scale. Finished size: ${finishedSizeLabel}. Artwork size: ${artworkSizeLabel}. Scale: ${scaleMatch.matchedScaleLabel}.`;

    return {
      quotedWidthMm,
      quotedHeightMm,
      detectedWidthMm,
      detectedHeightMm,
      matchedScale: scaleMatch.matchedScale,
      matchedScaleLabel: scaleMatch.matchedScaleLabel,
      widthScalePercent: Math.round(scaleMatch.widthScale * 1000) / 10,
      heightScalePercent: Math.round(scaleMatch.heightScale * 1000) / 10,
      aspectRatioMatches: true,
      rotationMatches: scaleMatch.rotationMatches,
      comparisonStatus: "pass",
      expectedFinishedWidthMm: quotedWidthMm,
      expectedFinishedHeightMm: quotedHeightMm,
      artworkResolutionDpi: null,
      effectiveResolutionDpi: null,
      message,
    };
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

  const widthScalePercent = Math.round(directWidthScale * 1000) / 10;
  const heightScalePercent = Math.round(directHeightScale * 1000) / 10;
  const widthScaleLabel = formatScalePercentLabel(directWidthScale);
  const heightScaleLabel = formatScalePercentLabel(directHeightScale);

  if (!scalesAgreeWithinTolerance(directWidthScale, directHeightScale)) {
    return {
      quotedWidthMm,
      quotedHeightMm,
      detectedWidthMm,
      detectedHeightMm,
      matchedScale: null,
      matchedScaleLabel: null,
      widthScalePercent,
      heightScalePercent,
      aspectRatioMatches: aspectOk,
      rotationMatches:
        aspectOk &&
        aspectRatioMatches(
          detectedWidthMm,
          detectedHeightMm,
          quotedHeightMm,
          quotedWidthMm
        ),
      comparisonStatus: "manual_review",
      expectedFinishedWidthMm: null,
      expectedFinishedHeightMm: null,
      artworkResolutionDpi: null,
      effectiveResolutionDpi: null,
      message: `Artwork proportions do not match quoted finished size. Width scale: ${widthScaleLabel}. Height scale: ${heightScaleLabel}.`,
    };
  }

  return {
    quotedWidthMm,
    quotedHeightMm,
    detectedWidthMm,
    detectedHeightMm,
    matchedScale: null,
    matchedScaleLabel: null,
    widthScalePercent,
    heightScalePercent,
    aspectRatioMatches: aspectOk,
    rotationMatches:
      aspectOk &&
      aspectRatioMatches(
        detectedWidthMm,
        detectedHeightMm,
        quotedHeightMm,
        quotedWidthMm
      ),
    comparisonStatus: aspectOk ? "warning" : "manual_review",
    expectedFinishedWidthMm: null,
    expectedFinishedHeightMm: null,
    artworkResolutionDpi: null,
    effectiveResolutionDpi: null,
    message: aspectOk
      ? `Aspect ratio matches quoted specification, but artwork scale (${formatScalePercentLabel(
          (directWidthScale + directHeightScale) / 2
        )}) does not match common production scales.`
      : "Artwork size does not match quoted specification.",
  };
}

export function computeArtworkDpi(input: {
  widthPx: number;
  heightPx: number;
  artworkWidthMm: number;
  artworkHeightMm: number;
}) {
  if (
    input.widthPx <= 0 ||
    input.heightPx <= 0 ||
    input.artworkWidthMm <= 0 ||
    input.artworkHeightMm <= 0
  ) {
    return null;
  }

  const widthInches = input.artworkWidthMm / 25.4;
  const heightInches = input.artworkHeightMm / 25.4;
  const dpiWidth = input.widthPx / widthInches;
  const dpiHeight = input.heightPx / heightInches;

  return Math.round(Math.min(dpiWidth, dpiHeight));
}

export function computeEffectiveDpi(input: {
  widthPx: number;
  heightPx: number;
  artworkWidthMm: number;
  artworkHeightMm: number;
  finishedScale: number | null;
}) {
  const artworkDpi = computeArtworkDpi(input);

  if (artworkDpi == null || input.finishedScale == null || input.finishedScale <= 0) {
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

  return Math.round(artworkDpi * input.finishedScale);
}

export function enrichSizeComparisonWithResolution(
  sizeComparison: SizeComparisonResult,
  input: {
    widthPx: number | null;
    heightPx: number | null;
    artworkWidthMm: number | null;
    artworkHeightMm: number | null;
    embeddedDpi?: number | null;
  }
): SizeComparisonResult {
  if (
    input.artworkWidthMm == null ||
    input.artworkHeightMm == null ||
    input.widthPx == null ||
    input.heightPx == null
  ) {
    return sizeComparison;
  }

  const artworkResolutionDpi =
    input.embeddedDpi ??
    computeArtworkDpi({
      widthPx: input.widthPx,
      heightPx: input.heightPx,
      artworkWidthMm: input.artworkWidthMm,
      artworkHeightMm: input.artworkHeightMm,
    });

  const effectiveResolutionDpi =
    sizeComparison.matchedScale != null && artworkResolutionDpi != null
      ? Math.round(artworkResolutionDpi * sizeComparison.matchedScale)
      : computeEffectiveDpi({
          widthPx: input.widthPx,
          heightPx: input.heightPx,
          artworkWidthMm: input.artworkWidthMm,
          artworkHeightMm: input.artworkHeightMm,
          finishedScale: sizeComparison.matchedScale,
        });

  return {
    ...sizeComparison,
    artworkResolutionDpi,
    effectiveResolutionDpi,
  };
}
