import type { QuotedSpecificationItem } from "@/lib/proof-generator/types";
import {
  extractCutPathGeometry,
  cutPathGeometryHasContent,
  formatCutPathExtractionFailureReason,
} from "@/lib/proof-generator/extract-cut-path-geometry";
import {
  buildFeatureCandidates,
  isProductionSeparationName,
  nameMatchesCutPath,
  nameMatchesWhiteInk,
  scanPdfContent,
  scoreCutPathConfidence,
  scoreWhiteInkConfidence,
  type PdfContentScan,
  type PdfNamedFeature,
} from "@/lib/proof-generator/scan-pdf-content";
import type {
  DetectedConfidence,
  FontPreflightResult,
  ImagePreflightResult,
  LayerSeparationSummary,
  ProductionFeatureCandidate,
  ProductionFeaturesResult,
  SpotColourGroups,
} from "@/lib/proof-generator/types";

function toCandidate(feature: PdfNamedFeature): ProductionFeatureCandidate {
  return {
    name: feature.name,
    sourceType: feature.sourceType,
    confidence: feature.confidence,
    reason: feature.reason,
  };
}

export function quotedItemsExpectCutPath(items: QuotedSpecificationItem[]) {
  for (const item of items) {
    const text = [
      item.finishing,
      item.printSpecification,
      item.material,
      item.notes,
      item.description,
      item.itemName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (
      /contour|kiss.?cut|die.?cut|cut.?path|router|shaped|custom.?shape|vinyl.?cut|cut.?vinyl/.test(
        text
      )
    ) {
      return true;
    }
  }

  return false;
}

export function groupSpotColours(names: string[]): SpotColourGroups {
  const productionSeparations: string[] = [];
  const otherSpotColours: string[] = [];

  for (const name of names) {
    if (nameMatchesCutPath(name) || nameMatchesWhiteInk(name) || isProductionSeparationName(name)) {
      productionSeparations.push(name);
    } else {
      otherSpotColours.push(name);
    }
  }

  return {
    productionSeparations,
    otherSpotColours,
  };
}

export function buildLayerSummaries(scan: PdfContentScan): LayerSeparationSummary[] {
  const summaries: LayerSeparationSummary[] = [];
  const seen = new Set<string>();

  for (const layer of scan.layers) {
    const key = `${layer.sourceType}:${layer.name.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    summaries.push({
      name: layer.name,
      sourceType: layer.sourceType,
      notes: layer.reason,
    });
  }

  for (const separation of scan.separations) {
    const key = `separation:${separation.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    summaries.push({
      name: separation,
      sourceType: "separation",
      notes: "Separation name",
    });
  }

  return summaries.slice(0, 30);
}

export function buildFontPreflight(scan: PdfContentScan): FontPreflightResult {
  if (scan.fontNames.length > 0) {
    return {
      status: "live_fonts_detected",
      names: scan.fontNames,
      confidence: "medium",
      message: `Live fonts detected: ${scan.fontNames.slice(0, 5).join(", ")}${
        scan.fontNames.length > 5 ? "…" : ""
      }`,
    };
  }

  if (!scan.hasFontObjects) {
    return {
      status: "all_outlined",
      names: [],
      confidence: "medium",
      message: "No live fonts detected.",
    };
  }

  return {
    status: "unknown",
    names: [],
    confidence: "low",
    message: "Font status could not be determined.",
  };
}

export function buildImagePreflight(
  scan: PdfContentScan,
  inputType: "pdf" | "image" | "ai_pdf_compatible"
): ImagePreflightResult {
  const count = scan.rasterImages.length;

  if (scan.missingLinkHints.length > 0) {
    return {
      count,
      linkStatus: "missing_links_detected",
      missingLinks: scan.missingLinkHints,
      confidence: "medium",
      message: "Missing linked artwork detected.",
    };
  }

  if (count > 0) {
    return {
      count,
      linkStatus: "embedded",
      missingLinks: [],
      confidence: "medium",
      message: `${count} embedded image${count === 1 ? "" : "s"} detected.`,
    };
  }

  if (inputType === "ai_pdf_compatible") {
    return {
      count: 0,
      linkStatus: "unknown",
      missingLinks: [],
      confidence: "low",
      message: "Linked-image status unavailable from PDF-compatible artwork.",
    };
  }

  if (inputType === "pdf") {
    return {
      count: 0,
      linkStatus: scan.hasEmbeddedFileRefs ? "embedded" : "unknown",
      missingLinks: [],
      confidence: "low",
      message:
        count === 0
          ? "No embedded raster images detected in PDF scan."
          : "Embedded images detected.",
    };
  }

  return {
    count,
    linkStatus: "embedded",
    missingLinks: [],
    confidence: "high",
    message: count > 0 ? `${count} embedded image${count === 1 ? "" : "s"} detected.` : "Image file.",
  };
}

export function buildProductionFeaturesFromScan(
  scan: PdfContentScan,
  quotedItems: QuotedSpecificationItem[]
): ProductionFeaturesResult {
  const cutPathCandidates = buildFeatureCandidates(
    scan,
    nameMatchesCutPath,
    scoreCutPathConfidence,
    "Possible cut path"
  ).map(toCandidate);

  const whiteInkCandidates = buildFeatureCandidates(
    scan,
    nameMatchesWhiteInk,
    scoreWhiteInkConfidence,
    "Possible white ink"
  ).map(toCandidate);

  return {
    cutPathCandidates,
    whiteInkCandidates,
    layers: buildLayerSummaries(scan),
    spotColourGroups: groupSpotColours(scan.spotColourNames),
    expectsCutPath: quotedItemsExpectCutPath(quotedItems),
    cutPathOverlayAvailable: false,
    cutPathOverlayReason:
      "Cut-path overlay availability is determined after vector geometry extraction.",
    cutPathOverlayRendered: false,
  };
}

export async function enrichProductionFeaturesWithCutPathOverlay(
  features: ProductionFeaturesResult,
  sourceBuffer: Buffer | undefined,
  separationName?: string | null
): Promise<ProductionFeaturesResult> {
  if (!sourceBuffer?.length || !separationName) {
    return {
      ...features,
      cutPathOverlayAvailable: false,
      cutPathOverlayReason:
        "Visual overlay unavailable — no PDF artwork or cut path selected.",
    };
  }

  const extraction = await extractCutPathGeometry(sourceBuffer, separationName, 0, {
    debugLabel: "preflight_overlay_availability",
  });
  if (!extraction.ok || !cutPathGeometryHasContent(extraction.geometry)) {
    return {
      ...features,
      cutPathOverlayAvailable: false,
      cutPathOverlayReason:
        formatCutPathExtractionFailureReason(extraction.diagnostic) ??
        "Visual overlay unavailable — vector geometry could not be extracted from this artwork.",
    };
  }

  return {
    ...features,
    cutPathOverlayAvailable: true,
    cutPathOverlayReason: null,
  };
}

export async function resolveCutPathOverlayAvailabilityForPreflight(
  preflight: {
    productionFeatures: ProductionFeaturesResult;
    metadata: { inputType: string };
  },
  sourceBuffer: Buffer | undefined
) {
  if (
    preflight.metadata.inputType === "image" ||
    preflight.metadata.inputType === "ai_unsupported" ||
    !sourceBuffer?.length
  ) {
    return preflight.productionFeatures;
  }

  const candidateName =
    preflight.productionFeatures.cutPathCandidates[0]?.name ??
    preflight.productionFeatures.confirmedCutPath?.name ??
    null;

  if (!candidateName) {
    return {
      ...preflight.productionFeatures,
      cutPathOverlayAvailable: false,
      cutPathOverlayReason:
        "Visual overlay unavailable — no cut path candidate detected in artwork.",
    };
  }

  return enrichProductionFeaturesWithCutPathOverlay(
    preflight.productionFeatures,
    sourceBuffer,
    candidateName
  );
}

export function formatCandidateSourceLabel(
  sourceType: ProductionFeatureCandidate["sourceType"]
) {
  switch (sourceType) {
    case "layer":
      return "Layer";
    case "spot_colour":
      return "Spot colour";
    case "separation":
      return "Separation";
    case "optional_content_group":
      return "Optional Content Group";
    default:
      return "Detected";
  }
}

export function confidenceLabel(confidence: DetectedConfidence) {
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}
