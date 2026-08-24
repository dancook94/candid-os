import {
  LOW_EFFECTIVE_DPI_THRESHOLD,
  PROOF_GENERATOR_ANALYSIS_VERSION,
} from "@/lib/proof-generator/constants";
import {
  buildFontPreflight,
  buildImagePreflight,
  buildProductionFeaturesFromScan,
} from "@/lib/proof-generator/production-features";
import { scanPdfContent, type PdfContentScan } from "@/lib/proof-generator/scan-pdf-content";
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
  FontPreflightResult,
  ImagePreflightResult,
  PreflightCheck,
  PreflightOverallStatus,
  PreflightResult,
  ProductionFeaturesResult,
  QuotedSpecificationItem,
  SizeComparisonResult,
} from "@/lib/proof-generator/types";

const EMPTY_PDF_SCAN: PdfContentScan = {
  layers: [],
  separations: [],
  spotColourNames: [],
  fontNames: [],
  hasFontObjects: false,
  hasToUnicode: false,
  hasEmbeddedFileRefs: false,
  missingLinkHints: [],
  rasterImages: [],
  cmykPresent: false,
  rgbPresent: false,
  grayscalePresent: false,
};

function worstStatus(statuses: PreflightOverallStatus[]): PreflightOverallStatus {
  if (statuses.includes("fail")) {
    return "fail";
  }

  if (statuses.includes("manual_review")) {
    return "manual_review";
  }

  if (statuses.includes("warning")) {
    return "warning";
  }

  return "pass";
}

function checkToOverall(status: PreflightCheck["status"]): PreflightOverallStatus {
  if (status === "fail") {
    return "fail";
  }

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
  const finishedSize =
    input.metadata.finishedSize?.value ?? input.metadata.trimBox.value ?? input.metadata.pageSize.value;

  if (!primaryQuoted) {
    return null;
  }

  const comparison = compareArtworkToQuotedSize({
    quotedWidthMm: primaryQuoted.quotedWidthMm,
    quotedHeightMm: primaryQuoted.quotedHeightMm,
    detectedWidthMm: finishedSize?.widthMm ?? null,
    detectedHeightMm: finishedSize?.heightMm ?? null,
    finishedSizeSource: input.metadata.finishedSizeSource?.value ?? null,
  });

  const pixels = resolveRasterPixels(input.metadata);

  if (!pixels || finishedSize == null) {
    return comparison;
  }

  return enrichSizeComparisonWithResolution(comparison, {
    widthPx: pixels.widthPx,
    heightPx: pixels.heightPx,
    artworkWidthMm: finishedSize.widthMm,
    artworkHeightMm: finishedSize.heightMm,
    embeddedDpi: pixels.embeddedDpi,
  });
}

function buildBasePreflightChecks(input: {
  metadata: DetectedArtworkMetadata;
  quotedItems: QuotedSpecificationItem[];
  sizeComparison: SizeComparisonResult | null;
}): PreflightCheck[] {
  const { metadata, quotedItems, sizeComparison } = input;
  const checks: PreflightCheck[] = [];
  const primaryQuoted = quotedItems[0] ?? null;
  const pageSize = metadata.pageSize.value;
  const finishedSize = metadata.finishedSize?.value ?? metadata.trimBox.value ?? pageSize;
  const finishedSizeSource = metadata.finishedSizeSource?.value ?? null;

  if (sizeComparison && primaryQuoted) {
    checks.push({
      key: "size_scale",
      label: "Size / scale",
      status: sizeComparison.comparisonStatus,
      detectedValue: finishedSize
        ? `${finishedSize.widthMm} x ${finishedSize.heightMm} mm`
        : null,
      expectedValue:
        primaryQuoted.quotedWidthMm != null && primaryQuoted.quotedHeightMm != null
          ? `${primaryQuoted.quotedWidthMm} x ${primaryQuoted.quotedHeightMm} mm`
          : null,
      message: sizeComparison.message,
      confidence: finishedSize ? metadata.finishedSize?.confidence ?? metadata.pageSize.confidence : "low",
    });

    checks.push({
      key: "aspect_ratio",
      label: "Aspect ratio",
      status: sizeComparison.aspectRatioMatches ? "pass" : "manual_review",
      detectedValue: finishedSize
        ? `${finishedSize.widthMm}:${finishedSize.heightMm}`
        : null,
      expectedValue:
        primaryQuoted.quotedWidthMm != null && primaryQuoted.quotedHeightMm != null
          ? `${primaryQuoted.quotedWidthMm}:${primaryQuoted.quotedHeightMm}`
          : null,
      message: sizeComparison.aspectRatioMatches
        ? "Aspect ratio matches quoted specification."
        : "Aspect ratio does not match quoted specification.",
      confidence: finishedSize ? metadata.finishedSize?.confidence ?? metadata.pageSize.confidence : "low",
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
  const bleedAllowance =
    metadata.bleedAllowanceMm?.value ??
    computeBleedAllowanceMm(trimBox, bleedBoxValue);

  if (finishedSizeSource === "media_box" && !metadata.trimBox.value) {
    checks.push({
      key: "finished_size_resolution",
      label: "Finished size resolution",
      status: "manual_review",
      detectedValue: finishedSize ? formatDimensionsLabel(finishedSize) : null,
      expectedValue: null,
      message: "Finished size could not be reliably determined.",
      confidence: "low",
    });
  }

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
      finishedSize &&
      sizeComparison?.matchedScale
    ) {
      const primary = rasterImages[0];
      const effectiveDpi = computeEffectiveDpi({
        widthPx: primary.widthPx,
        heightPx: primary.heightPx,
        artworkWidthMm: finishedSize.widthMm,
        artworkHeightMm: finishedSize.heightMm,
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

function buildProductionFeatureChecks(input: {
  metadata: DetectedArtworkMetadata;
  productionFeatures: ProductionFeaturesResult;
  fonts: FontPreflightResult;
  images: ImagePreflightResult;
}): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const { productionFeatures, fonts, images, metadata } = input;

  if (metadata.inputType === "ai_unsupported") {
    checks.push({
      key: "ai_preflight_unavailable",
      label: "Illustrator preflight",
      status: "manual_review",
      detectedValue: "Unsupported AI file",
      expectedValue: "PDF-compatible export",
      message:
        metadata.analysisNote ??
        "Advanced preflight is unavailable for this Illustrator file. Export a PDF-compatible copy for analysis.",
      confidence: "high",
    });
    return checks;
  }

  if (productionFeatures.cutPathCandidates.length > 0) {
    checks.push({
      key: "cut_path_candidates",
      label: "Cut path candidates",
      status: "manual_review",
      detectedValue: productionFeatures.cutPathCandidates
        .map((candidate) => candidate.name)
        .join(", "),
      expectedValue: null,
      message:
        "Possible cut path detected — Candid confirmation required.",
      confidence: productionFeatures.cutPathCandidates[0]?.confidence ?? "medium",
    });
  } else if (productionFeatures.expectsCutPath) {
    checks.push({
      key: "cut_path_expected",
      label: "Cut path expected",
      status: "manual_review",
      detectedValue: "None detected",
      expectedValue: "Cut path for contour/kiss-cut item",
      message:
        "Quoted finishing suggests contour cutting, but no cut path candidate was detected.",
      confidence: "medium",
    });
  }

  if (productionFeatures.whiteInkCandidates.length > 0) {
    checks.push({
      key: "white_ink_candidates",
      label: "White ink candidates",
      status: "manual_review",
      detectedValue: productionFeatures.whiteInkCandidates
        .map((candidate) => candidate.name)
        .join(", "),
      expectedValue: null,
      message: "Possible white-ink separation detected. Confirm or mark not required.",
      confidence: productionFeatures.whiteInkCandidates[0]?.confidence ?? "medium",
    });
  }

  if (fonts.status === "live_fonts_detected") {
    checks.push({
      key: "live_fonts",
      label: "Live fonts",
      status: "warning",
      detectedValue: fonts.names.join(", "),
      expectedValue: "Outlined or embedded fonts",
      message: fonts.message,
      confidence: fonts.confidence,
    });
  } else if (fonts.status === "all_outlined") {
    checks.push({
      key: "live_fonts",
      label: "Live fonts",
      status: "pass",
      detectedValue: "None detected",
      expectedValue: null,
      message: fonts.message,
      confidence: fonts.confidence,
    });
  } else {
    checks.push({
      key: "live_fonts",
      label: "Live fonts",
      status: "manual_review",
      detectedValue: null,
      expectedValue: null,
      message: fonts.message,
      confidence: fonts.confidence,
    });
  }

  if (images.linkStatus === "missing_links_detected") {
    checks.push({
      key: "missing_linked_artwork",
      label: "Missing linked artwork",
      status: "fail",
      detectedValue: images.missingLinks.join(", "),
      expectedValue: "Embedded artwork",
      message: images.message,
      confidence: images.confidence,
    });
  } else {
    checks.push({
      key: "embedded_images",
      label: "Images",
      status: images.linkStatus === "unknown" ? "manual_review" : "info",
      detectedValue:
        images.count > 0
          ? `${images.count} embedded image${images.count === 1 ? "" : "s"}`
          : "None detected",
      expectedValue: null,
      message: images.message,
      confidence: images.confidence,
    });
  }

  const productionSpots = productionFeatures.spotColourGroups.productionSeparations;
  if (productionSpots.length > 0) {
    checks.push({
      key: "production_separations",
      label: "Production separations",
      status: "info",
      detectedValue: productionSpots.join(", "),
      expectedValue: null,
      message: "Production separation names detected (cut path, white ink, etc.).",
      confidence: "medium",
    });
  }

  const otherSpots = productionFeatures.spotColourGroups.otherSpotColours;
  if (otherSpots.length > 0) {
    checks.push({
      key: "other_spot_colours",
      label: "Other spot colours",
      status: "info",
      detectedValue: otherSpots.join(", "),
      expectedValue: null,
      message: "Additional spot colour names detected.",
      confidence: "medium",
    });
  }

  return checks;
}

export function resolvePreflightChecksAfterProductionConfirmation(
  checks: PreflightCheck[],
  productionFeatures: ProductionFeaturesResult
): PreflightCheck[] {
  const resolved = checks.filter((check) => {
    if (check.key === "cut_path_candidates" || check.key === "cut_path_expected") {
      return (
        !productionFeatures.confirmedCutPath &&
        !productionFeatures.noCutLineRequired &&
        !productionFeatures.cutPathRequiredNotDetected
      );
    }

    if (check.key === "white_ink_candidates") {
      return !productionFeatures.confirmedWhiteInk && !productionFeatures.noWhiteInkRequired;
    }

    return true;
  });

  if (productionFeatures.confirmedCutPath) {
    resolved.push({
      key: "cut_path_confirmed",
      label: "Cut path",
      status: "pass",
      detectedValue: productionFeatures.confirmedCutPath.name,
      expectedValue: null,
      message: `${productionFeatures.confirmedCutPath.name} confirmed by Candid`,
      confidence: "high",
    });
  } else if (productionFeatures.noCutLineRequired) {
    resolved.push({
      key: "cut_path_not_required",
      label: "Cut path",
      status: "pass",
      detectedValue: "No cut line required",
      expectedValue: null,
      message: "No cut line required",
      confidence: "high",
    });
  } else if (productionFeatures.cutPathRequiredNotDetected) {
    resolved.push({
      key: "cut_path_required_missing",
      label: "Cut path",
      status: "warning",
      detectedValue: "None detected",
      expectedValue: "Cut path for contour/kiss-cut item",
      message: "Required cut path not detected",
      confidence: "medium",
    });
  }

  if (productionFeatures.confirmedWhiteInk) {
    resolved.push({
      key: "white_ink_confirmed",
      label: "White ink",
      status: "pass",
      detectedValue: productionFeatures.confirmedWhiteInk.name,
      expectedValue: null,
      message: `${productionFeatures.confirmedWhiteInk.name} confirmed by Candid`,
      confidence: "high",
    });
  } else if (productionFeatures.noWhiteInkRequired) {
    resolved.push({
      key: "white_ink_not_required",
      label: "White ink",
      status: "pass",
      detectedValue: "Not required",
      expectedValue: null,
      message: "White ink not required",
      confidence: "high",
    });
  }

  return resolved;
}

export function buildPreflightChecks(input: {
  metadata: DetectedArtworkMetadata;
  quotedItems: QuotedSpecificationItem[];
  sizeComparison: SizeComparisonResult | null;
  productionFeatures: ProductionFeaturesResult;
  fonts: FontPreflightResult;
  images: ImagePreflightResult;
}): PreflightCheck[] {
  return [
    ...buildBasePreflightChecks(input),
    ...buildProductionFeatureChecks(input),
  ];
}

function resolvePdfScan(
  metadata: DetectedArtworkMetadata,
  sourceBuffer?: Buffer
): PdfContentScan | null {
  if (
    metadata.inputType === "ai_unsupported" ||
    metadata.inputType === "image" ||
    !sourceBuffer?.length
  ) {
    return null;
  }

  return scanPdfContent(sourceBuffer);
}

function resolveImageScan(metadata: DetectedArtworkMetadata): PdfContentScan {
  return {
    ...EMPTY_PDF_SCAN,
    rasterImages: metadata.rasterImages.value.map((image) => ({
      widthPx: image.widthPx,
      heightPx: image.heightPx,
    })),
  };
}

export function buildPreflightResult(input: {
  metadata: DetectedArtworkMetadata;
  quotedItems: QuotedSpecificationItem[];
  sourceReference: PreflightResult["sourceReference"];
  sourceBuffer?: Buffer;
}): PreflightResult {
  const sizeComparison = buildSizeComparison({
    metadata: input.metadata,
    quotedItems: input.quotedItems,
  });

  const scan = resolvePdfScan(input.metadata, input.sourceBuffer);
  const imageScan = resolveImageScan(input.metadata);
  const productionFeatures = buildProductionFeaturesFromScan(
    scan ?? EMPTY_PDF_SCAN,
    input.quotedItems
  );

  const fonts = scan
    ? buildFontPreflight(scan)
    : input.metadata.inputType === "image"
      ? {
          status: "unknown" as const,
          names: [],
          confidence: "low" as const,
          message: "Font status could not be determined for raster artwork.",
        }
      : {
          status: "unknown" as const,
          names: [],
          confidence: "low" as const,
          message: "Font status could not be determined.",
        };

  const images = scan
    ? buildImagePreflight(
        scan,
        input.metadata.inputType === "ai_pdf_compatible" ? "ai_pdf_compatible" : "pdf"
      )
    : buildImagePreflight(
        imageScan,
        input.metadata.inputType === "image" ? "image" : "pdf"
      );

  const checks = buildPreflightChecks({
    metadata: input.metadata,
    quotedItems: input.quotedItems,
    sizeComparison,
    productionFeatures,
    fonts,
    images,
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
    productionFeatures,
    fonts,
    images,
    sourceReference: input.sourceReference,
  };
}
