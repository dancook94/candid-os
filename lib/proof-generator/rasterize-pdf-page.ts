import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createCanvas } from "@napi-rs/canvas";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import { logProofGeneratorDebug } from "@/lib/proof-generator/artwork-buffer";
import {
  countDarkPixelsFromPng,
  countDarkPixelsFromRgba,
} from "@/lib/proof-generator/canvas-image";
import { PROOF_PDF_PREVIEW_MAX_PX } from "@/lib/proof-generator/constants";

const require = createRequire(import.meta.url);

export type RasterizedPdfPage = {
  pngBuffer: Buffer;
  rgbaData: Uint8ClampedArray;
  widthPx: number;
  heightPx: number;
  pageWidthPt: number;
  pageHeightPt: number;
  renderScale: number;
  renderer: "pdfjs-dist";
};

function getPdfJsAssetUrls() {
  const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return {
    standardFontDataUrl: pathToFileURL(path.join(pdfjsRoot, "standard_fonts/")).href,
    cMapUrl: pathToFileURL(path.join(pdfjsRoot, "cmaps/")).href,
  };
}

async function buildFullVisibilityOptionalContentConfig(
  document: PDFDocumentProxy,
  intent: "display" | "print" | "any"
) {
  try {
    const config = await document.getOptionalContentConfig({ intent });
    for (const [groupId] of config) {
      config.setVisibility(groupId, true);
    }
    return config;
  } catch {
    return null;
  }
}

export function sourcePdfContainsTextOperand(sourceBuffer: Buffer, label: string) {
  if (sourceBuffer.includes(Buffer.from(label, "utf8"))) {
    return true;
  }

  const latin = sourceBuffer.toString("latin1");
  if (latin.includes(`(${label})`) || latin.includes(`(${label.toLowerCase()})`)) {
    return true;
  }

  const hexLabel = Buffer.from(label, "utf8").toString("hex").toUpperCase();
  return latin.toUpperCase().includes(`<${hexLabel}>`);
}

export async function countDarkPixels(pngBuffer: Buffer, threshold = 80) {
  return countDarkPixelsFromPng(pngBuffer, threshold);
}

export async function validateFlattenedArtworkPreview(input: {
  sourceBuffer: Buffer;
  pngBuffer: Buffer;
  rgbaData?: Uint8ClampedArray;
  expectedTextLabel?: string;
  requireVisibleText?: boolean;
  minDarkPixels?: number;
}) {
  const label = input.expectedTextLabel ?? "Test";
  const shouldValidate =
    input.requireVisibleText === true || sourcePdfContainsTextOperand(input.sourceBuffer, label);

  if (!shouldValidate) {
    return { ok: true as const, skipped: true as const };
  }

  const darkPixels = input.rgbaData
    ? countDarkPixelsFromRgba(input.rgbaData)
    : await countDarkPixels(input.pngBuffer);
  const minRequired =
    input.minDarkPixels ?? Math.max(250, Math.floor(input.pngBuffer.length / 4000));

  if (darkPixels < minRequired) {
    return {
      ok: false as const,
      reason: `Flattened artwork preview is missing visible "${label}" text (${darkPixels} dark pixels, expected at least ${minRequired}).`,
      darkPixels,
    };
  }

  return { ok: true as const, darkPixels };
}

/**
 * Flatten the original production PDF page through pdf.js into a PNG preview.
 * In Node, disableFontFace must stay true so pdf.js draws glyph outlines directly
 * instead of loading @font-face fonts into canvas (which produces box/X glyphs).
 */
export async function rasterizePdfPageToPng(
  pdfBuffer: Buffer,
  pageIndex = 0
): Promise<RasterizedPdfPage> {
  const assets = getPdfJsAssetUrls();

  const document = await getDocument({
    data: new Uint8Array(pdfBuffer),
    standardFontDataUrl: assets.standardFontDataUrl,
    cMapUrl: assets.cMapUrl,
    cMapPacked: true,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;

  const pageNumber = pageIndex + 1;
  if (pageNumber > document.numPages) {
    throw new Error(`PDF page ${pageNumber} does not exist.`);
  }

  const page = await document.getPage(pageNumber);
  const viewportAtScale1 = page.getViewport({ scale: 1 });
  const renderScale = Math.min(
    PROOF_PDF_PREVIEW_MAX_PX / viewportAtScale1.width,
    PROOF_PDF_PREVIEW_MAX_PX / viewportAtScale1.height
  );
  const viewport = page.getViewport({ scale: renderScale });
  const widthPx = Math.max(1, Math.ceil(viewport.width));
  const heightPx = Math.max(1, Math.ceil(viewport.height));
  const canvas = createCanvas(widthPx, heightPx);
  const context = canvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, widthPx, heightPx);

  const renderIntent = "print";
  const optionalContentConfig = await buildFullVisibilityOptionalContentConfig(
    document,
    renderIntent
  );

  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
    intent: renderIntent,
    optionalContentConfigPromise: optionalContentConfig
      ? Promise.resolve(optionalContentConfig)
      : document.getOptionalContentConfig({ intent: renderIntent }),
  }).promise;

  page.cleanup();

  logProofGeneratorDebug("artwork_preview_flattened", {
    renderer: "pdfjs-dist",
    widthPx,
    heightPx,
    pageWidthPt: viewportAtScale1.width,
    pageHeightPt: viewportAtScale1.height,
    renderScale,
    disableFontFace: true,
  });

  const rgbaData = context.getImageData(0, 0, widthPx, heightPx).data;

  return {
    pngBuffer: canvas.toBuffer("image/png"),
    rgbaData,
    widthPx,
    heightPx,
    pageWidthPt: viewportAtScale1.width,
    pageHeightPt: viewportAtScale1.height,
    renderScale,
    renderer: "pdfjs-dist",
  };
}
