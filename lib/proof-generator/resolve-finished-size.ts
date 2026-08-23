import {
  computeCutPathBounds,
  cutPathBoundsToDimensions,
  type CutPathBoundsResult,
} from "@/lib/proof-generator/cut-path-bounds";
import { compareArtworkToQuotedSize, enrichSizeComparisonWithResolution } from "@/lib/proof-generator/compare-specification";
import {
  cutPathGeometryHasContent,
  extractCutPathGeometry,
} from "@/lib/proof-generator/extract-cut-path-geometry";
import type { FinishedSizeSource } from "@/lib/proof-generator/resolve-pdf-geometry";
import type {
  AuthoritativeFinishedSizeSource,
  CutPathBoundsSummary,
  CutPathContourBounds,
  CutPathShapeKind,
  DetectedArtworkMetadata,
  DetectedConfidence,
  DetectedValue,
  PdfBoxDimensions,
  PreflightResult,
  ProductionFeaturesResult,
  QuotedSpecificationItem,
  SizeComparisonResult,
} from "@/lib/proof-generator/types";
import { buildPreflightChecks } from "@/lib/proof-generator/warnings";

export type { AuthoritativeFinishedSizeSource } from "@/lib/proof-generator/types";

export type ResolvedProductionFinishedSize = {
  finishedSize: PdfBoxDimensions | null;
  finishedSizeSource: AuthoritativeFinishedSizeSource | null;
  finishedSizeConfidence: DetectedConfidence;
  cutPathSize: PdfBoxDimensions | null;
  cutPathBounds: CutPathBoundsSummary | null;
  cutPathContours: CutPathContourBounds[];
  cutPathShape: CutPathShapeKind | null;
  trimSize: PdfBoxDimensions | null;
  requiresManualReview: boolean;
  cutPathGeometryExtractable: boolean;
};

function detected<T>(
  value: T,
  confidence: DetectedConfidence,
  source: string
): DetectedValue<T> {
  return { value, confidence, source };
}

function resolveTrimSize(metadata: DetectedArtworkMetadata): PdfBoxDimensions | null {
  return metadata.trimBox.value ?? metadata.finishedSize?.value ?? metadata.pageSize.value;
}

export async function extractCutPathBoundsFromArtwork(
  sourceBuffer: Buffer | undefined,
  cutPathName: string | null | undefined
): Promise<CutPathBoundsResult | null> {
  if (!sourceBuffer?.length || !cutPathName) {
    return null;
  }

  const extraction = await extractCutPathGeometry(sourceBuffer, cutPathName, 0, {
    debugLabel: "cut_path_bounds",
  });

  if (!extraction.ok || !cutPathGeometryHasContent(extraction.geometry)) {
    return null;
  }

  return computeCutPathBounds(extraction.geometry);
}

export async function resolveAuthoritativeFinishedSize(input: {
  metadata: DetectedArtworkMetadata;
  productionFeatures: ProductionFeaturesResult;
  sourceBuffer?: Buffer;
}): Promise<ResolvedProductionFinishedSize> {
  const trimSize = resolveTrimSize(input.metadata);
  const baseFinishedSize = input.metadata.finishedSize?.value ?? trimSize;
  const baseSource =
    (input.metadata.finishedSizeSource?.value as AuthoritativeFinishedSizeSource | null) ??
    null;

  const features = input.productionFeatures;

  if (features.noCutLineRequired) {
    return {
      finishedSize: baseFinishedSize,
      finishedSizeSource: baseSource,
      finishedSizeConfidence: input.metadata.finishedSize?.confidence ?? "medium",
      cutPathSize: null,
      cutPathBounds: null,
      cutPathContours: [],
      cutPathShape: null,
      trimSize,
      requiresManualReview: false,
      cutPathGeometryExtractable: false,
    };
  }

  if (features.cutPathRequiredNotDetected) {
    return {
      finishedSize: null,
      finishedSizeSource: "manual_review",
      finishedSizeConfidence: "low",
      cutPathSize: null,
      cutPathBounds: null,
      cutPathContours: [],
      cutPathShape: null,
      trimSize,
      requiresManualReview: true,
      cutPathGeometryExtractable: false,
    };
  }

  if (features.confirmedCutPath) {
    const bounds = await extractCutPathBoundsFromArtwork(
      input.sourceBuffer,
      features.confirmedCutPath.name
    );

    if (bounds) {
      const cutPathSize = cutPathBoundsToDimensions(bounds);
      return {
        finishedSize: cutPathSize,
        finishedSizeSource: "cut_path",
        finishedSizeConfidence: "high",
        cutPathSize,
        cutPathBounds: bounds,
        cutPathContours: bounds.contours,
        cutPathShape: bounds.overallShape,
        trimSize,
        requiresManualReview: false,
        cutPathGeometryExtractable: true,
      };
    }

    return {
      finishedSize: null,
      finishedSizeSource: "manual_review",
      finishedSizeConfidence: "low",
      cutPathSize: null,
      cutPathBounds: null,
      cutPathContours: [],
      cutPathShape: null,
      trimSize,
      requiresManualReview: true,
      cutPathGeometryExtractable: false,
    };
  }

  return {
    finishedSize: baseFinishedSize,
    finishedSizeSource: baseSource,
    finishedSizeConfidence: input.metadata.finishedSize?.confidence ?? "medium",
    cutPathSize: null,
    cutPathBounds: null,
    cutPathContours: [],
    cutPathShape: null,
    trimSize,
    requiresManualReview: false,
    cutPathGeometryExtractable: false,
  };
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

export function buildSizeComparisonForFinishedSize(input: {
  metadata: DetectedArtworkMetadata;
  quotedItems: QuotedSpecificationItem[];
  finishedSize: PdfBoxDimensions | null;
  finishedSizeSource: AuthoritativeFinishedSizeSource | null;
}): SizeComparisonResult | null {
  const primaryQuoted = input.quotedItems[0] ?? null;
  if (!primaryQuoted) {
    return null;
  }

  const comparison = compareArtworkToQuotedSize({
    quotedWidthMm: primaryQuoted.quotedWidthMm,
    quotedHeightMm: primaryQuoted.quotedHeightMm,
    detectedWidthMm: input.finishedSize?.widthMm ?? null,
    detectedHeightMm: input.finishedSize?.heightMm ?? null,
    finishedSizeSource: input.finishedSizeSource,
  });

  const pixels = resolveRasterPixels(input.metadata);
  if (!pixels || !input.finishedSize) {
    return comparison;
  }

  return enrichSizeComparisonWithResolution(comparison, {
    widthPx: pixels.widthPx,
    heightPx: pixels.heightPx,
    artworkWidthMm: input.finishedSize.widthMm,
    artworkHeightMm: input.finishedSize.heightMm,
    embeddedDpi: pixels.embeddedDpi,
  });
}

export async function applyAuthoritativeFinishedSizeToPreflight(
  preflight: PreflightResult,
  sourceBuffer?: Buffer
): Promise<PreflightResult> {
  const resolved = await resolveAuthoritativeFinishedSize({
    metadata: preflight.metadata,
    productionFeatures: preflight.productionFeatures,
    sourceBuffer,
  });

  const metadata: DetectedArtworkMetadata = {
    ...preflight.metadata,
    finishedSize: detected(
      resolved.finishedSize,
      resolved.finishedSizeConfidence,
      resolved.finishedSizeSource === "cut_path"
        ? "cut_path_bounds"
        : preflight.metadata.finishedSize?.source ?? "resolved"
    ),
    finishedSizeSource: detected(
      resolved.finishedSizeSource,
      resolved.finishedSizeConfidence,
      resolved.finishedSizeSource === "cut_path"
        ? "cut_path_bounds"
        : preflight.metadata.finishedSizeSource?.source ?? "resolved"
    ),
  };

  const productionFeatures: ProductionFeaturesResult = {
    ...preflight.productionFeatures,
    cutPathSize: resolved.cutPathSize,
    cutPathBounds: resolved.cutPathBounds,
    cutPathContours: resolved.cutPathContours,
    cutPathShape: resolved.cutPathShape,
    resolvedProductionFinishedSize: resolved.finishedSize,
    resolvedProductionFinishedSizeSource: resolved.finishedSizeSource,
    cutPathSizeExtractable: resolved.cutPathGeometryExtractable,
    finishedSizeRequiresManualReview: resolved.requiresManualReview,
  };

  const sizeComparison = buildSizeComparisonForFinishedSize({
    metadata,
    quotedItems: preflight.quotedItems,
    finishedSize: resolved.finishedSize,
    finishedSizeSource: resolved.finishedSizeSource,
  });

  const checks = buildPreflightChecks({
    metadata,
    quotedItems: preflight.quotedItems,
    sizeComparison,
    productionFeatures,
    fonts: preflight.fonts,
    images: preflight.images,
  });

  const rank: Record<PreflightResult["overallStatus"], number> = {
    pass: 0,
    warning: 1,
    manual_review: 2,
    fail: 3,
  };

  const overallStatus = checks.reduce<PreflightResult["overallStatus"]>((worst, check) => {
    const mapped =
      check.status === "pass"
        ? "pass"
        : check.status === "warning"
          ? "warning"
          : check.status === "fail"
            ? "fail"
            : check.status === "info"
              ? "pass"
              : "manual_review";
    return rank[mapped] > rank[worst] ? mapped : worst;
  }, "pass");

  return {
    ...preflight,
    metadata,
    productionFeatures,
    sizeComparison,
    checks,
    overallStatus,
  };
}

export function formatAuthoritativeFinishedSizeSourceLabel(
  source: AuthoritativeFinishedSizeSource | null | undefined,
  cutPathName?: string | null
) {
  switch (source) {
    case "cut_path":
      return cutPathName ? cutPathName : "Confirmed cut path";
    case "manual_review":
      return "Manual review required";
    case "trim_box":
      return "PDF TrimBox";
    case "art_box":
      return "PDF ArtBox";
    case "crop_marks":
      return "Crop marks";
    case "crop_box":
      return "PDF CropBox";
    case "media_box":
      return "PDF MediaBox";
    default:
      return "Not determined";
  }
}
