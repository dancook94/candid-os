import {
  LOW_EFFECTIVE_DPI_THRESHOLD,
  PROOF_GENERATOR_ANALYSIS_VERSION,
} from "@/lib/proof-generator/constants";
import {
  computeBleedAllowanceMm,
  formatDimensionsLabel,
} from "@/lib/proof-generator/analyse-pdf";
import {
  compareArtworkToQuotedSize,
  computeEffectiveDpi,
  enrichSizeComparisonWithResolution,
} from "@/lib/proof-generator/compare-specification";
import type {
  DetectedArtworkMetadata,
  PreflightCheck,
  PreflightOverallStatus,
  PreflightResult,
  QuotedSpecificationItem,
  SizeComparisonResult,
} from "@/lib/proof-generator/types";

function worstStatus(statuses: PreflightOverallStatus[]): PreflightOverallStatus {
  if (statuses.includes("manual_review")) {
    return "manual_review";
  }

  if (statuses.includes("warning")) {
    return "warning";
  }

  return "pass";
}

function checkToOverall(status: PreflightCheck["status"]): PreflightOverallStatus {
  if (status === "manual_review") {
    return "manual_review";
  }

  if (status === "warning") {
    return "warning";
  }

  return "pass";
}

function resolveRasterPixels(metadata: DetectedArtworkMetadata) {
  const raster = metadata.rasterImages.value[0];
  if (raster) {
    return {
      widthPx: raster.widthPx,
      heightPx: raster.heightPx,
      embeddedDpi: raster.effectiveDpiAtArtworkSize,
    };
  }

  if (metadata.imageWidthPx.value != null && metadata.imageHeightPx.value != null) {
    return {
      widthPx: metadata.imageWidthPx.value,
      heightPx: metadata.imageHeightPx.value,
      embeddedDpi: null,
    };
  }

  return null;
}

function buildSizeComparison(input: {
  metadata: DetectedArtworkMetadata;
  quotedItems: QuotedSpecificationItem[];
}): SizeComparisonResult | null {
  const primaryQuoted = input.quotedItems[0] ?? null;
  const pageSize = input.metadata.pageSize.value;

  if (!primaryQuoted) {
    return null;
  }

  const comparison = compareArtworkToQuotedSize({
    quotedWidthMm: primaryQuoted.quotedWidthMm,
    quotedHeightMm: primaryQuoted.quotedHeightMm,
    detectedWidthMm: pageSize?.widthMm ?? null,
    detectedHeightMm: pageSize?.heightMm ?? null,
  });

  const pixels = resolveRasterPixels(input.metadata);

  if (!pixels || pageSize == null) {
    return comparison;
  }

  return enrichSizeComparisonWithResolution(comparison, {
    widthPx: pixels.widthPx,
    heightPx: pixels.heightPx,
    artworkWidthMm: pageSize.widthMm,
    artworkHeightMm: pageSize.heightMm,
    embeddedDpi: pixels.embeddedDpi,
  });
}

export function buildPreflightChecks(input: {
  metadata: DetectedArtworkMetadata;
  quotedItems: QuotedSpecificationItem[];
  sizeComparison: SizeComparisonResult | null;
}): PreflightCheck[] {
  const { metadata, quotedItems, sizeComparison } = input;
  const checks: PreflightCheck[] = [];
  const primaryQuoted = quotedItems[0] ?? null;
  const pageSize = metadata.pageSize.value;

  if (sizeComparison && primaryQuoted) {
    checks.push({
      key: "size_scale",
      label: "Size / scale",
      status: sizeComparison.comparisonStatus,
      detectedValue: pageSize
        ? `${pageSize.widthMm} x ${pageSize.heightMm} mm`
        : null,
      expectedValue:
        primaryQuoted.quotedWidthMm != null && primaryQuoted.quotedHeightMm != null
          ? `${primaryQuoted.quotedWidthMm} x ${primaryQuoted.quotedHeightMm} mm`
          : null,
      message: sizeComparison.message,
      confidence: pageSize ? metadata.pageSize.confidence : "low",
    });

    checks.push({
      key: "aspect_ratio",
      label: "Aspect ratio",
      status: sizeComparison.aspectRatioMatches ? "pass" : "manual_review",
      detectedValue: pageSize
        ? `${pageSize.widthMm}:${pageSize.heightMm}`
        : null,
      expectedValue:
        primaryQuoted.quotedWidthMm != null && primaryQuoted.quotedHeightMm != null
          ? `${primaryQuoted.quotedWidthMm}:${primaryQuoted.quotedHeightMm}`
          : null,
      message: sizeComparison.aspectRatioMatches
        ? "Aspect ratio matches quoted specification."
        : "Aspect ratio does not match quoted specification.",
      confidence: pageSize ? metadata.pageSize.confidence : "low",
    });

    if (sizeComparison.rotationMatches) {
      checks.push({
        key: "orientation",
        label: "Orientation",
        status: "pass",
        detectedValue: metadata.orientation.value,
        expectedValue: "Rotated match",
        message: "Artwork dimensions match quoted specification when rotated.",
        confidence: metadata.orientation.confidence,
      });
    }
  }

  checks.push({
    key: "page_count",
    label: "Page count",
    status: "info",
    detectedValue: metadata.pageCount != null ? String(metadata.pageCount) : null,
    expectedValue: primaryQuoted?.quantity != null ? String(primaryQuoted.quantity) : null,
    message:
      metadata.pageCount != null && primaryQuoted?.quantity != null
        ? `Quoted quantity: ${primaryQuoted.quantity}. PDF pages: ${metadata.pageCount}. Page count is not assumed to equal print quantity.`
        : metadata.pageCount != null
          ? `PDF pages: ${metadata.pageCount}.`
          : "Page count could not be detected.",
    confidence: metadata.pageCount != null ? "high" : "low",
  });

  checks.push({
    key: "colour_mode",
    label: "Colour mode",
    status: metadata.colourMode.value === "Unknown" ? "manual_review" : "info",
    detectedValue: metadata.colourMode.value,
    expectedValue: null,
    message:
      metadata.colourMode.value === "Unknown"
        ? "Colour mode could not be reliably detected."
        : `${metadata.colourMode.value} content detected.`,
    confidence: metadata.colourMode.confidence,
  });

  if (metadata.rgbPresent.value) {
    checks.push({
      key: "rgb_content",
      label: "RGB content",
      status: "warning",
      detectedValue: "RGB present",
      expectedValue: "CMYK preferred for print",
      message:
        "RGB content may change appearance when converted for print. Review before production.",
      confidence: metadata.rgbPresent.confidence,
    });
  }

  if (metadata.cmykPresent.value) {
    checks.push({
      key: "cmyk_content",
      label: "CMYK content",
      status: "pass",
      detectedValue: "CMYK present",
      expectedValue: null,
      message: "CMYK content detected.",
      confidence: metadata.cmykPresent.confidence,
    });
  }

  const spotNames = metadata.spotColourNames.value;
  if (spotNames.length > 0) {
    checks.push({
      key: "spot_colours",
      label: "Spot colours",
      status: "info",
      detectedValue: spotNames.join(", "),
      expectedValue: null,
      message: "Spot/separation colour names detected.",
      confidence: metadata.spotColourNames.confidence,
    });
  }

  const trimBox = metadata.trimBox.value;
  const bleedBoxValue = metadata.bleedBox.value;
  const bleedAllowance = computeBleedAllowanceMm(trimBox, bleedBoxValue);

  if (bleedBoxValue) {
    checks.push({
      key: "bleed_box",
      label: "Bleed metadata",
      status: "info",
      detectedValue: formatDimensionsLabel(bleedBoxValue),
      expectedValue: trimBox ? formatDimensionsLabel(trimBox) : null,
      message: bleedAllowance
        ? `Detected bleed allowance ~ ${bleedAllowance} mm.`
        : "Bleed box detected.",
      confidence: metadata.bleedBox.confidence,
    });
  } else {
    checks.push({
      key: "bleed_box",
      label: "Bleed metadata",
      status: "manual_review",
      detectedValue: null,
      expectedValue: null,
      message: "PDF bleed box not detected - manual check required.",
      confidence: "medium",
    });
  }

  if (sizeComparison?.artworkResolutionDpi != null) {
    checks.push({
      key: "artwork_resolution",
      label: "Artwork resolution",
      status: "info",
      detectedValue: `${sizeComparison.artworkResolutionDpi} DPI`,
      expectedValue: null,
      message: "Resolution at supplied artwork size.",
      confidence: "medium",
    });
  }

  if (sizeComparison?.effectiveResolutionDpi != null) {
    checks.push({
      key: "effective_resolution",
      label: "Effective resolution",
      status:
        sizeComparison.effectiveResolutionDpi < LOW_EFFECTIVE_DPI_THRESHOLD
          ? "warning"
          : "info",
      detectedValue: `${sizeComparison.effectiveResolutionDpi} DPI at finished size`,
      expectedValue: null,
      message:
        sizeComparison.effectiveResolutionDpi < LOW_EFFECTIVE_DPI_THRESHOLD
          ? "Manual resolution review recommended for large-format output."
          : sizeComparison.matchedScaleLabel
            ? `Effective finished resolution at ${sizeComparison.matchedScaleLabel} scale.`
            : "Effective resolution calculated at intended finished size.",
      confidence: "medium",
    });
  } else {
    const rasterImages = metadata.rasterImages.value;
    if (
      rasterImages.length > 0 &&
      pageSize &&
      sizeComparison?.matchedScale
    ) {
      const primary = rasterImages[0];
      const effectiveDpi = computeEffectiveDpi({
        widthPx: primary.widthPx,
        heightPx: primary.heightPx,
        artworkWidthMm: pageSize.widthMm,
        artworkHeightMm: pageSize.heightMm,
        finishedScale: sizeComparison.matchedScale,
      });

      if (effectiveDpi != null) {
        checks.push({
          key: "effective_resolution",
          label: "Effective resolution",
          status:
            effectiveDpi < LOW_EFFECTIVE_DPI_THRESHOLD ? "warning" : "info",
          detectedValue: `${effectiveDpi} DPI at finished size`,
          expectedValue: null,
          message:
            effectiveDpi < LOW_EFFECTIVE_DPI_THRESHOLD
              ? "Manual resolution review recommended for large-format output."
              : "Effective resolution calculated at intended finished size.",
          confidence: "low",
        });
      }
    }
  }

  checks.push({
    key: "file_metadata",
    label: "File metadata",
    status: "info",
    detectedValue: `${metadata.fileName} (${Math.round(metadata.fileSizeBytes / 1024)} KB)`,
    expectedValue: metadata.pdfVersion.value ? `PDF ${metadata.pdfVersion.value}` : null,
    message: metadata.pdfVersion.value
      ? `PDF version ${metadata.pdfVersion.value} detected.`
      : "Basic file metadata recorded.",
    confidence: metadata.pdfVersion.confidence,
  });

  return checks;
}

export function buildPreflightResult(input: {
  metadata: DetectedArtworkMetadata;
  quotedItems: QuotedSpecificationItem[];
  sourceReference: PreflightResult["sourceReference"];
}): PreflightResult {
  const sizeComparison = buildSizeComparison({
    metadata: input.metadata,
    quotedItems: input.quotedItems,
  });

  const checks = buildPreflightChecks({
    metadata: input.metadata,
    quotedItems: input.quotedItems,
    sizeComparison,
  });

  const overallStatus = worstStatus(
    checks.map((check) => checkToOverall(check.status))
  );

  return {
    analysisVersion: PROOF_GENERATOR_ANALYSIS_VERSION,
    overallStatus,
    checks,
    metadata: input.metadata,
    sizeComparison,
    quotedItems: input.quotedItems,
    sourceReference: input.sourceReference,
  };
}
