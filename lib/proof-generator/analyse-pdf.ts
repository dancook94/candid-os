import { PDFDocument } from "pdf-lib";

import { PT_TO_MM } from "@/lib/proof-generator/constants";
import type {
  DetectedArtworkMetadata,
  DetectedConfidence,
  DetectedValue,
  PdfBoxDimensions,
} from "@/lib/proof-generator/types";

function detected<T>(
  value: T,
  confidence: DetectedConfidence,
  source: string
): DetectedValue<T> {
  return { value, confidence, source };
}

function pointsToMm(value: number) {
  return Math.round(value * PT_TO_MM * 100) / 100;
}

function dimensionsFromPoints(widthPt: number, heightPt: number): PdfBoxDimensions {
  return {
    widthPt: Math.round(widthPt * 100) / 100,
    heightPt: Math.round(heightPt * 100) / 100,
    widthMm: pointsToMm(widthPt),
    heightMm: pointsToMm(heightPt),
  };
}

function orientationFromDimensions(widthMm: number, heightMm: number) {
  const delta = Math.abs(widthMm - heightMm);
  if (delta < 1) {
    return "square" as const;
  }

  return widthMm > heightMm ? ("landscape" as const) : ("portrait" as const);
}

function extractPdfVersion(buffer: Buffer): DetectedValue<string | null> {
  const header = buffer.subarray(0, Math.min(buffer.length, 16)).toString("latin1");
  const match = header.match(/%PDF-(\d\.\d)/);

  if (!match) {
    return detected(null, "low", "pdf_header");
  }

  return detected(match[1], "high", "pdf_header");
}

type RawBoxMatch = {
  name: string;
  widthPt: number;
  heightPt: number;
};

function extractPdfBoxes(buffer: Buffer): RawBoxMatch[] {
  const text = buffer.toString("latin1");
  const matches: RawBoxMatch[] = [];
  const pattern =
    /\/(MediaBox|CropBox|TrimBox|BleedBox|ArtBox)\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*]/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const [, name, x1, y1, x2, y2] = match;
    const widthPt = Math.abs(Number.parseFloat(x2) - Number.parseFloat(x1));
    const heightPt = Math.abs(Number.parseFloat(y2) - Number.parseFloat(y1));

    if (widthPt > 0 && heightPt > 0) {
      matches.push({ name, widthPt, heightPt });
    }
  }

  return matches;
}

function pickBox(
  boxes: RawBoxMatch[],
  name: string
): DetectedValue<PdfBoxDimensions | null> {
  const found = boxes.find((box) => box.name === name);

  if (!found) {
    return detected(null, "medium", "pdf_box_scan");
  }

  return detected(
    dimensionsFromPoints(found.widthPt, found.heightPt),
    "medium",
    "pdf_box_scan"
  );
}

function scanColourUsage(buffer: Buffer) {
  const text = buffer.toString("latin1");
  const cmykPresent =
    /\/DeviceCMYK|\/CMYK\b|\/ICCBased.*\/Alternate\s*\/DeviceCMYK/.test(text);
  const rgbPresent =
    /\/DeviceRGB|\/RGB\b|\/ICCBased.*\/Alternate\s*\/DeviceRGB/.test(text);
  const grayscalePresent = /\/DeviceGray|\/G\b/.test(text);

  const spotNames = new Set<string>();
  const separationPattern = /\/Separation\s*\/([A-Za-z0-9_+-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = separationPattern.exec(text)) !== null) {
    if (match[1] && !["DeviceCMYK", "DeviceRGB", "DeviceGray"].includes(match[1])) {
      spotNames.add(match[1]);
    }
  }

  let colourMode: DetectedArtworkMetadata["colourMode"]["value"] = "Unknown";
  const modes = [
    cmykPresent ? "CMYK" : null,
    rgbPresent ? "RGB" : null,
    grayscalePresent ? "Grayscale" : null,
  ].filter(Boolean);

  if (modes.length > 1) {
    colourMode = "Mixed";
  } else if (modes.length === 1) {
    colourMode = modes[0] as "CMYK" | "RGB" | "Grayscale";
  }

  return {
    colourMode: detected(colourMode, modes.length ? "medium" : "low", "pdf_content_scan"),
    cmykPresent: detected(cmykPresent, "medium", "pdf_content_scan"),
    rgbPresent: detected(rgbPresent, "medium", "pdf_content_scan"),
    grayscalePresent: detected(grayscalePresent, "medium", "pdf_content_scan"),
    spotColourNames: detected(
      [...spotNames],
      spotNames.size ? "medium" : "low",
      "pdf_content_scan"
    ),
  };
}

function scanFonts(buffer: Buffer): DetectedValue<string[]> {
  const text = buffer.toString("latin1");
  const fonts = new Set<string>();
  const pattern = /\/BaseFont\s*\/([A-Za-z0-9+-]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match[1]) {
      fonts.add(match[1].replace(/^\+/, ""));
    }
  }

  return detected(
    [...fonts].slice(0, 20),
    fonts.size ? "medium" : "low",
    "pdf_font_scan"
  );
}

function scanRasterHints(buffer: Buffer) {
  const text = buffer.toString("latin1");
  const images: Array<{
    widthPx: number;
    heightPx: number;
    effectiveDpiAtArtworkSize: number | null;
    effectiveDpiAtFinishedSize: number | null;
  }> = [];

  const pattern = /\/Width\s+(\d+)[\s\S]{0,120}?\/Height\s+(\d+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const widthPx = Number.parseInt(match[1], 10);
    const heightPx = Number.parseInt(match[2], 10);

    if (widthPx > 0 && heightPx > 0) {
      images.push({
        widthPx,
        heightPx,
        effectiveDpiAtArtworkSize: null,
        effectiveDpiAtFinishedSize: null,
      });
    }
  }

  return detected(
    images.slice(0, 10),
    images.length ? "low" : "low",
    "pdf_image_scan"
  );
}

export async function analysePdfBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string | null
): Promise<DetectedArtworkMetadata> {
  const pdfVersion = extractPdfVersion(buffer);
  const boxes = extractPdfBoxes(buffer);
  const colour = scanColourUsage(buffer);
  const fonts = scanFonts(buffer);
  const rasterImages = scanRasterHints(buffer);

  let pageCount: number | null = null;
  let pageSize: DetectedValue<PdfBoxDimensions | null> = detected(
    null,
    "low",
    "pdf_lib"
  );
  let orientation: DetectedValue<
    "portrait" | "landscape" | "square" | null
  > = detected(null, "low", "pdf_lib");

  try {
    const document = await PDFDocument.load(buffer, { ignoreEncryption: true });
    pageCount = document.getPageCount();

    if (pageCount > 0) {
      const firstPage = document.getPage(0);
      const { width, height } = firstPage.getSize();
      const dimensions = dimensionsFromPoints(width, height);
      pageSize = detected(dimensions, "high", "pdf_lib");
      orientation = detected(
        orientationFromDimensions(dimensions.widthMm, dimensions.heightMm),
        "high",
        "pdf_lib"
      );
    }
  } catch {
    pageCount = null;
  }

  const mediaBox = pickBox(boxes, "MediaBox");
  const resolvedPageSize =
    pageSize.value ??
    mediaBox.value ??
    pickBox(boxes, "CropBox").value ??
    null;

  if (!pageSize.value && resolvedPageSize) {
    pageSize = detected(resolvedPageSize, "medium", "pdf_box_scan");
    orientation = detected(
      orientationFromDimensions(resolvedPageSize.widthMm, resolvedPageSize.heightMm),
      "medium",
      "pdf_box_scan"
    );
  }

  return {
    fileName,
    fileSizeBytes: buffer.length,
    mimeType,
    inputType: "pdf",
    pageCount,
    pdfVersion,
    pageSize,
    orientation,
    mediaBox: mediaBox.value ? mediaBox : pageSize,
    cropBox: pickBox(boxes, "CropBox"),
    trimBox: pickBox(boxes, "TrimBox"),
    bleedBox: pickBox(boxes, "BleedBox"),
    artBox: pickBox(boxes, "ArtBox"),
    colourMode: colour.colourMode,
    cmykPresent: colour.cmykPresent,
    rgbPresent: colour.rgbPresent,
    grayscalePresent: colour.grayscalePresent,
    spotColourNames: colour.spotColourNames,
    fonts,
    rasterImages,
    imageWidthPx: detected(null, "low", "n/a"),
    imageHeightPx: detected(null, "low", "n/a"),
  };
}

export function formatDimensionsLabel(dimensions: PdfBoxDimensions | null) {
  if (!dimensions) {
    return "—";
  }

  return `${dimensions.widthMm} × ${dimensions.heightMm} mm`;
}

export function computeBleedAllowanceMm(
  trimBox: PdfBoxDimensions | null,
  bleedBox: PdfBoxDimensions | null
) {
  if (!trimBox || !bleedBox) {
    return null;
  }

  const horizontal = Math.max(
    0,
    Math.round(((bleedBox.widthMm - trimBox.widthMm) / 2) * 100) / 100
  );
  const vertical = Math.max(
    0,
    Math.round(((bleedBox.heightMm - trimBox.heightMm) / 2) * 100) / 100
  );

  if (horizontal <= 0 && vertical <= 0) {
    return null;
  }

  return Math.max(horizontal, vertical);
}
