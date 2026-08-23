import type { DetectedConfidence } from "@/lib/proof-generator/types";

export type PdfFeatureSourceType =
  | "layer"
  | "spot_colour"
  | "separation"
  | "optional_content_group";

export type PdfNamedFeature = {
  name: string;
  sourceType: PdfFeatureSourceType;
  confidence: DetectedConfidence;
  reason: string;
};

export type PdfContentScan = {
  layers: PdfNamedFeature[];
  separations: string[];
  spotColourNames: string[];
  fontNames: string[];
  hasFontObjects: boolean;
  hasToUnicode: boolean;
  hasEmbeddedFileRefs: boolean;
  missingLinkHints: string[];
  rasterImages: Array<{ widthPx: number; heightPx: number }>;
  cmykPresent: boolean;
  rgbPresent: boolean;
  grayscalePresent: boolean;
};

const PRODUCTION_SEPARATION_HINTS = [
  /cut/i,
  /white/i,
  /varnish/i,
  /primer/i,
  /metallic/i,
  /\bclear\b/i,
  /underbase/i,
];

const CUT_PATH_PATTERNS = [
  /cutcontour/i,
  /cut\s*contour/i,
  /cutline/i,
  /cut\s*line/i,
  /cutpath/i,
  /cut\s*path/i,
  /kisscut/i,
  /kiss\s*cut/i,
  /thrucut/i,
  /thru\s*cut/i,
  /throughcut/i,
  /through\s*cut/i,
  /diecut/i,
  /die\s*cut/i,
  /contourcut/i,
  /contour\s*cut/i,
];

const WHITE_INK_PATTERNS = [
  /^white$/i,
  /white\s*ink/i,
  /spot\s*white/i,
  /opaque\s*white/i,
  /^underbase$/i,
  /white\s*underbase/i,
];

function uniqueNames(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function decodePdfString(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function collectParenthesizedNames(text: string, pattern: RegExp) {
  const names: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1]?.trim();
    if (raw && raw.length <= 120 && !/^[\d.]+$/.test(raw)) {
      names.push(decodePdfString(raw));
    }
  }

  return names;
}

export function nameMatchesCutPath(name: string) {
  if (CUT_PATH_PATTERNS.some((pattern) => pattern.test(name))) {
    return true;
  }

  return /\bcut\b/i.test(name);
}

export function nameMatchesWhiteInk(name: string) {
  return WHITE_INK_PATTERNS.some((pattern) => pattern.test(name));
}

export function isProductionSeparationName(name: string) {
  return PRODUCTION_SEPARATION_HINTS.some((pattern) => pattern.test(name));
}

export function scoreCutPathConfidence(name: string): DetectedConfidence {
  if (/cutcontour|cut\s*contour|die\s*cut|kisscut|kiss\s*cut/i.test(name)) {
    return "high";
  }

  if (/\bcut\b/i.test(name)) {
    return "medium";
  }

  return "low";
}

export function scoreWhiteInkConfidence(name: string): DetectedConfidence {
  if (/spot\s*white|white\s*ink|opaque\s*white|white\s*underbase/i.test(name)) {
    return "high";
  }

  if (/^white$|^underbase$/i.test(name)) {
    return "medium";
  }

  return "low";
}

function scanSeparations(text: string) {
  const names = new Set<string>();
  const separationPattern = /\/Separation\s*\/([A-Za-z0-9_+-]+)/g;
  let match: RegExpExecArray | null;

  while ((match = separationPattern.exec(text)) !== null) {
    const name = match[1];
    if (name && !["DeviceCMYK", "DeviceRGB", "DeviceGray"].includes(name)) {
      names.add(name);
    }
  }

  const deviceNPattern = /\/DeviceN\s*\[\s*([^\]]+)\]/g;
  while ((match = deviceNPattern.exec(text)) !== null) {
    const parts = match[1]
      .split(/\s+/)
      .map((part) => part.replace(/^\//, "").trim())
      .filter(Boolean);

    for (const part of parts) {
      if (!["DeviceCMYK", "DeviceRGB", "DeviceGray", "CMYK", "RGB", "Gray"].includes(part)) {
        names.add(part);
      }
    }
  }

  return [...names];
}

function scanLayersAndOcgs(text: string): PdfNamedFeature[] {
  const features: PdfNamedFeature[] = [];
  const seen = new Set<string>();

  function addFeature(name: string, sourceType: PdfFeatureSourceType, reason: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) {
      return;
    }

    const key = `${sourceType}:${trimmed.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    features.push({
      name: trimmed,
      sourceType,
      confidence: sourceType === "optional_content_group" ? "medium" : "medium",
      reason,
    });
  }

  for (const name of collectParenthesizedNames(text, /\/Name\s*\(([^)]+)\)/g)) {
    addFeature(name, "optional_content_group", "Optional Content Group name");
  }

  for (const name of collectParenthesizedNames(text, /\/Title\s*\(([^)]+)\)/g)) {
    addFeature(name, "layer", "Layer title metadata");
  }

  for (const name of collectParenthesizedNames(text, /\/Layer\s*<<[\s\S]{0,160}?\/Name\s*\(([^)]+)\)/g)) {
    addFeature(name, "layer", "Layer dictionary name");
  }

  for (const name of collectParenthesizedNames(text, /\/OCG\s*<<[\s\S]{0,160}?\/Name\s*\(([^)]+)\)/g)) {
    addFeature(name, "optional_content_group", "Optional Content Group dictionary");
  }

  return features;
}

function scanFonts(text: string) {
  const fonts = new Set<string>();
  const pattern = /\/BaseFont\s*\/([A-Za-z0-9+-]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match[1]) {
      fonts.add(match[1].replace(/^\+/, ""));
    }
  }

  return {
    fontNames: [...fonts].slice(0, 30),
    hasFontObjects: /\/Type\s*\/Font\b/.test(text),
    hasToUnicode: /\/ToUnicode\b/.test(text),
  };
}

function scanRasterImages(text: string) {
  const images: Array<{ widthPx: number; heightPx: number }> = [];
  const pattern = /\/Width\s+(\d+)[\s\S]{0,120}?\/Height\s+(\d+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const widthPx = Number.parseInt(match[1], 10);
    const heightPx = Number.parseInt(match[2], 10);

    if (widthPx > 0 && heightPx > 0) {
      images.push({ widthPx, heightPx });
    }
  }

  return images.slice(0, 20);
}

function scanMissingLinkHints(text: string) {
  const hints = new Set<string>();

  for (const name of collectParenthesizedNames(text, /\/Missing\s*\(([^)]+)\)/g)) {
    hints.add(name);
  }

  for (const name of collectParenthesizedNames(
    text,
    /\/FileSpec[\s\S]{0,220}?\/F\s*\(([^)]+)\)[\s\S]{0,120}?\/Missing\s*true/g
  )) {
    hints.add(name);
  }

  for (const name of collectParenthesizedNames(
    text,
    /\/FileSpec[\s\S]{0,220}?\/UF\s*\(([^)]+)\)[\s\S]{0,120}?\/Missing\s*true/g
  )) {
    hints.add(name);
  }

  return [...hints];
}

export function scanPdfContent(buffer: Buffer): PdfContentScan {
  const text = buffer.toString("latin1");
  const layers = scanLayersAndOcgs(text);
  const separations = scanSeparations(text);
  const spotColourNames = uniqueNames([
    ...separations,
    ...layers
      .filter((layer) => layer.sourceType === "spot_colour")
      .map((layer) => layer.name),
  ]);
  const fonts = scanFonts(text);

  return {
    layers,
    separations,
    spotColourNames,
    fontNames: fonts.fontNames,
    hasFontObjects: fonts.hasFontObjects,
    hasToUnicode: fonts.hasToUnicode,
    hasEmbeddedFileRefs: /\/EmbeddedFiles\b|\/EF\b/.test(text),
    missingLinkHints: scanMissingLinkHints(text),
    rasterImages: scanRasterImages(text),
    cmykPresent:
      /\/DeviceCMYK|\/CMYK\b|\/ICCBased[\s\S]{0,80}?\/Alternate\s*\/DeviceCMYK/.test(text),
    rgbPresent:
      /\/DeviceRGB|\/RGB\b|\/ICCBased[\s\S]{0,80}?\/Alternate\s*\/DeviceRGB/.test(text),
    grayscalePresent: /\/DeviceGray|\/G\b/.test(text),
  };
}

export function buildFeatureCandidates(
  scan: PdfContentScan,
  matcher: (name: string) => boolean,
  scoreConfidence: (name: string) => DetectedConfidence,
  featureLabel: string
): PdfNamedFeature[] {
  const candidates: PdfNamedFeature[] = [];
  const seen = new Set<string>();

  function addCandidate(name: string, sourceType: PdfFeatureSourceType, reason: string) {
    if (!matcher(name)) {
      return;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push({
      name,
      sourceType,
      confidence: scoreConfidence(name),
      reason: `${featureLabel} — ${reason}`,
    });
  }

  for (const separation of scan.separations) {
    addCandidate(separation, "separation", "Separation name");
  }

  for (const layer of scan.layers) {
    addCandidate(layer.name, layer.sourceType, layer.reason);
  }

  for (const spot of scan.spotColourNames) {
    addCandidate(spot, "spot_colour", "Spot colour name");
  }

  return candidates.sort((left, right) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[left.confidence] - order[right.confidence];
  });
}
