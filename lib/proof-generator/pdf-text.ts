import type { PdfBoxDimensions } from "@/lib/proof-generator/types";
import type { DetectedArtworkMetadata, PreflightCheck, PreflightResult, SizeComparisonResult } from "@/lib/proof-generator/types";

/** Legacy placeholder retained for joins that still expect a dash. */
export const PDF_MISSING_VALUE = "-";

export const PDF_NOT_SPECIFIED = "Not specified";
export const PDF_NOT_DETECTED = "Not detected";
export const PDF_NONE_DETECTED = "None detected";
export const PDF_MANUAL_REVIEW = "Manual review required";
export const PDF_UNKNOWN = "Unknown";

const EXPLICIT_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201A", "'"],
  ["\u201B", "'"],
  ["\u201C", '"'],
  ["\u201D", '"'],
  ["\u201E", '"'],
  ["\u2032", "'"],
  ["\u2033", '"'],
  ["\u2013", "-"],
  ["\u2014", "-"],
  ["\u2212", "-"],
  ["\u2026", "..."],
  ["\u00A0", " "],
  ["\u00D7", "x"],
  ["\u00B7", " | "],
  ["\u2192", "->"],
  ["\u2190", "<-"],
  ["\u26A0", "WARNING"],
  ["\u2713", "PASS"],
  ["\u2714", "PASS"],
  ["\u2022", "-"],
  ["\u25CF", "-"],
  ["\u2015", "-"],
  ["\uFEFF", ""],
];

/**
 * Helvetica StandardFonts in pdf-lib use WinAnsi encoding. Normalise dynamic and
 * static strings before drawText so customer/project names and preflight lines
 * do not crash generation on unsupported Unicode symbols.
 */
export function sanitizePdfText(value: string | null | undefined): string {
  if (value == null) {
    return "";
  }

  let text = String(value).normalize("NFKC");

  for (const [from, to] of EXPLICIT_REPLACEMENTS) {
    if (text.includes(from)) {
      text = text.split(from).join(to);
    }
  }

  return text.replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/g, "?");
}

export function statusPrefixForCheck(status: string): string {
  switch (status) {
    case "pass":
      return "PASS";
    case "warning":
      return "WARNING";
    case "manual_review":
      return "REVIEW";
    case "fail":
      return "FAIL";
    default:
      return "REVIEW";
  }
}

export function formatPdfDimensionsLabel(
  widthMm: number | null | undefined,
  heightMm: number | null | undefined
): string {
  if (widthMm == null || heightMm == null) {
    return PDF_NOT_SPECIFIED;
  }

  return sanitizePdfText(`${widthMm} x ${heightMm} mm`);
}

export function formatPdfDimensionsFromBox(dimensions: PdfBoxDimensions | null): string {
  if (!dimensions) {
    return PDF_NOT_DETECTED;
  }

  return formatPdfDimensionsLabel(dimensions.widthMm, dimensions.heightMm);
}

export function joinPdfParts(
  parts: Array<string | null | undefined>,
  separator = " | ",
  emptyLabel = PDF_NOT_SPECIFIED
): string {
  const joined = parts.filter(Boolean).join(separator);
  return sanitizePdfText(joined || emptyLabel);
}

export function formatProofFieldValue(value: string | null | undefined): string {
  if (!value?.trim()) {
    return PDF_NOT_SPECIFIED;
  }

  return sanitizePdfText(value);
}

export function formatProofQuantity(value: number | null | undefined): string {
  if (value == null) {
    return PDF_NOT_SPECIFIED;
  }

  return String(value);
}

export function formatProofScaleLabel(value: string | null | undefined): string {
  if (!value?.trim()) {
    return PDF_NOT_DETECTED;
  }

  return sanitizePdfText(value);
}

export function formatEffectiveResolutionLabel(
  sizeComparison: SizeComparisonResult | null | undefined
): string {
  if (sizeComparison?.effectiveResolutionDpi != null) {
    return `${sizeComparison.effectiveResolutionDpi} DPI`;
  }

  if (sizeComparison?.artworkResolutionDpi != null) {
    return `${sizeComparison.artworkResolutionDpi} DPI at artwork size`;
  }

  if (sizeComparison?.matchedScale != null) {
    return PDF_MANUAL_REVIEW;
  }

  return PDF_NOT_DETECTED;
}

export function formatSpotColoursLabel(metadata: DetectedArtworkMetadata): string {
  const names = metadata.spotColourNames.value.filter(
    (name) => !isCustomerSpotColourNoise(name)
  );
  const confidence = metadata.spotColourNames.confidence;

  if (names.length > 0) {
    return sanitizePdfText(names.join(", "));
  }

  if (confidence === "high" || confidence === "medium") {
    return PDF_NONE_DETECTED;
  }

  return PDF_NOT_DETECTED;
}

function isCustomerSpotColourNoise(name: string) {
  const normalized = name.trim().toLowerCase();
  return ["all", "none", "default", "cmyk", "rgb", "gray", "grey"].includes(normalized);
}

export function formatCustomerSpotColoursLabel(preflight: PreflightResult): string {
  const names = preflight.productionFeatures.spotColourGroups.otherSpotColours.filter(
    (name) => !isCustomerSpotColourNoise(name)
  );

  if (names.length > 0) {
    return sanitizePdfText(names.join(", "));
  }

  return PDF_NONE_DETECTED;
}

export function formatCustomerFontLabel(preflight: PreflightResult): string {
  if (preflight.fonts.status === "all_outlined") {
    return "No live fonts detected";
  }

  if (preflight.fonts.status === "live_fonts_detected") {
    const needsReview = preflight.checks.some(
      (check) => check.key === "live_fonts" && check.status === "warning"
    );
    return needsReview
      ? "Live text detected — Candid review required"
      : "Live text detected";
  }

  return "Could not be determined";
}

export function formatBleedMetadataLabel(check: PreflightCheck | undefined): string {
  if (!check) {
    return PDF_MANUAL_REVIEW;
  }

  if (check.status === "manual_review") {
    return PDF_MANUAL_REVIEW;
  }

  if (check.message?.trim()) {
    return sanitizePdfText(check.message);
  }

  return PDF_NOT_DETECTED;
}

export function formatPreflightCheckLine(input: {
  status: string;
  label: string;
  message: string;
}): string {
  return sanitizePdfText(
    `${statusPrefixForCheck(input.status)} - ${input.label}: ${input.message}`
  );
}

export function formatProductionFeaturesForCustomerProof(preflight: PreflightResult) {
  const rows: Array<{ label: string; value: string }> = [];
  const features = preflight.productionFeatures;

  if (features.confirmedCutPath) {
    rows.push({
      label: "Cut path",
      value: `${features.confirmedCutPath.name} — Confirmed`,
    });

    if (features.showCutPathOnProof) {
      rows.push({
        label: "Cut path preview",
        value: features.cutPathOverlayRendered
          ? "Shown on artwork"
          : "Not shown — Candid review required",
      });
    }
  } else if (features.noCutLineRequired) {
    rows.push({
      label: "Cut path",
      value: "No cut line required",
    });
  }

  if (features.confirmedWhiteInk) {
    rows.push({
      label: "White ink",
      value: `${features.confirmedWhiteInk.name} — Confirmed`,
    });
  } else if (features.noWhiteInkRequired) {
    rows.push({
      label: "White ink",
      value: "Not required",
    });
  }

  const productionSeparations = features.spotColourGroups.productionSeparations.filter(
    (name) =>
      name !== features.confirmedCutPath?.name && name !== features.confirmedWhiteInk?.name
  );

  if (productionSeparations.length > 0) {
    rows.push({
      label: "Production separations",
      value: sanitizePdfText(productionSeparations.join(", ")),
    });
  }

  if (
    preflight.fonts.status === "all_outlined" ||
    preflight.fonts.status === "live_fonts_detected" ||
    preflight.fonts.status === "unknown"
  ) {
    rows.push({ label: "Fonts", value: formatCustomerFontLabel(preflight) });
  }

  if (preflight.images.linkStatus === "embedded") {
    rows.push({ label: "Images", value: "Embedded" });
  } else if (preflight.images.linkStatus === "missing_links_detected") {
    rows.push({ label: "Images", value: "Missing linked artwork detected" });
  } else if (preflight.images.count > 0) {
    rows.push({
      label: "Images",
      value: `${preflight.images.count} embedded image${preflight.images.count === 1 ? "" : "s"}`,
    });
  }

  return rows;
}
