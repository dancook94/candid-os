import { PDFDocument } from "pdf-lib";

import { PT_TO_MM } from "@/lib/proof-generator/constants";
import { scanPdfContent } from "@/lib/proof-generator/scan-pdf-content";
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

export async function analysePdfBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string | null,
  options?: { inputType?: DetectedArtworkMetadata["inputType"]; analysisNote?: string | null }
): Promise<DetectedArtworkMetadata> {
  const pdfVersion = extractPdfVersion(buffer);
  const boxes = extractPdfBoxes(buffer);
  const scan = scanPdfContent(buffer);

  const modes = [
    scan.cmykPresent ? "CMYK" : null,
    scan.rgbPresent ? "RGB" : null,
    scan.grayscalePresent ? "Grayscale" : null,
  ].filter(Boolean);

  let colourMode: DetectedArtworkMetadata["colourMode"]["value"] = "Unknown";
  if (modes.length > 1) {
    colourMode = "Mixed";
  } else if (modes.length === 1) {
    colourMode = modes[0] as "CMYK" | "RGB" | "Grayscale";
  }

  const fonts = detected(
    scan.fontNames,
    scan.fontNames.length ? "medium" : scan.hasFontObjects ? "low" : "medium",
    "pdf_font_scan"
  );

  const rasterImages = detected(
    scan.rasterImages.map((image) => ({
      widthPx: image.widthPx,
      heightPx: image.heightPx,
      effectiveDpiAtArtworkSize: null,
      effectiveDpiAtFinishedSize: null,
    })),
    scan.rasterImages.length ? "medium" : "low",
    "pdf_image_scan"
  );

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
    inputType: options?.inputType ?? "pdf",
    analysisNote: options?.analysisNote ?? null,
    pageCount,
    pdfVersion,
    pageSize,
    orientation,
    mediaBox: mediaBox.value ? mediaBox : pageSize,
    cropBox: pickBox(boxes, "CropBox"),
    trimBox: pickBox(boxes, "TrimBox"),
    bleedBox: pickBox(boxes, "BleedBox"),
    artBox: pickBox(boxes, "ArtBox"),
    colourMode: detected(colourMode, modes.length ? "medium" : "low", "pdf_content_scan"),
    cmykPresent: detected(scan.cmykPresent, "medium", "pdf_content_scan"),
    rgbPresent: detected(scan.rgbPresent, "medium", "pdf_content_scan"),
    grayscalePresent: detected(scan.grayscalePresent, "medium", "pdf_content_scan"),
    spotColourNames: detected(
      scan.spotColourNames,
      scan.spotColourNames.length ? "medium" : "low",
      "pdf_content_scan"
    ),
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

export { scanPdfContent };
