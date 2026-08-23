import sharp from "sharp";

import type { DetectedArtworkMetadata } from "@/lib/proof-generator/types";

export async function analyseImageBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string | null
): Promise<DetectedArtworkMetadata> {
  const metadata = await sharp(buffer).metadata();
  const widthPx = metadata.width ?? null;
  const heightPx = metadata.height ?? null;

  let widthMm: number | null = null;
  let heightMm: number | null = null;

  if (metadata.density && widthPx && heightPx) {
    widthMm = Math.round(((widthPx / metadata.density) * 25.4) * 100) / 100;
    heightMm = Math.round(((heightPx / metadata.density) * 25.4) * 100) / 100;
  }

  const hasAlpha = metadata.hasAlpha ?? false;
  const colourMode =
    metadata.space === "cmyk"
      ? "CMYK"
      : metadata.space === "b-w"
        ? "Grayscale"
        : hasAlpha || metadata.space === "srgb" || metadata.channels === 3
          ? "RGB"
          : "Unknown";

  const pageSize =
    widthMm && heightMm
      ? {
          widthPt: 0,
          heightPt: 0,
          widthMm,
          heightMm,
        }
      : null;

  return {
    fileName,
    fileSizeBytes: buffer.length,
    mimeType,
    inputType: "image",
    pageCount: 1,
    pdfVersion: { value: null, confidence: "low", source: "n/a" },
    pageSize: {
      value: pageSize,
      confidence: pageSize ? "medium" : "low",
      source: pageSize ? "image_metadata" : "unavailable",
    },
    orientation: {
      value:
        widthMm && heightMm
          ? widthMm > heightMm
            ? "landscape"
            : widthMm < heightMm
              ? "portrait"
              : "square"
          : null,
      confidence: pageSize ? "medium" : "low",
      source: "image_metadata",
    },
    mediaBox: { value: pageSize, confidence: "medium", source: "image_metadata" },
    cropBox: { value: null, confidence: "low", source: "n/a" },
    trimBox: { value: null, confidence: "low", source: "n/a" },
    bleedBox: { value: null, confidence: "low", source: "n/a" },
    artBox: { value: null, confidence: "low", source: "n/a" },
    finishedSize: {
      value: pageSize,
      confidence: pageSize ? "medium" : "low",
      source: "image_metadata",
    },
    finishedSizeSource: {
      value: pageSize ? ("media_box" as const) : null,
      confidence: pageSize ? "medium" : "low",
      source: "image_metadata",
    },
    bleedAllowanceMm: { value: null, confidence: "low", source: "n/a" },
    colourMode: { value: colourMode, confidence: "medium", source: "sharp" },
    cmykPresent: {
      value: colourMode === "CMYK",
      confidence: "medium",
      source: "sharp",
    },
    rgbPresent: {
      value: colourMode === "RGB",
      confidence: "medium",
      source: "sharp",
    },
    grayscalePresent: {
      value: colourMode === "Grayscale",
      confidence: "medium",
      source: "sharp",
    },
    spotColourNames: { value: [], confidence: "low", source: "n/a" },
    fonts: { value: [], confidence: "low", source: "n/a" },
    rasterImages: {
      value:
        widthPx && heightPx
          ? [
              {
                widthPx,
                heightPx,
                effectiveDpiAtArtworkSize: metadata.density ?? null,
                effectiveDpiAtFinishedSize: null,
              },
            ]
          : [],
      confidence: widthPx ? "high" : "low",
      source: "sharp",
    },
    imageWidthPx: { value: widthPx, confidence: "high", source: "sharp" },
    imageHeightPx: { value: heightPx, confidence: "high", source: "sharp" },
  };
}
