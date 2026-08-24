import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { PROOF_PDF_PREVIEW_MAX_PX } from "@/lib/proof-generator/constants";

export type RasterizedPdfPage = {
  pngBuffer: Buffer;
  widthPx: number;
  heightPx: number;
  pageWidthPt: number;
  pageHeightPt: number;
  renderScale: number;
};

export async function rasterizePdfPageToPng(
  pdfBuffer: Buffer,
  pageIndex = 0
): Promise<RasterizedPdfPage> {
  const document = await getDocument({
    data: new Uint8Array(pdfBuffer),
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

  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  return {
    pngBuffer: canvas.toBuffer("image/png"),
    widthPx,
    heightPx,
    pageWidthPt: viewportAtScale1.width,
    pageHeightPt: viewportAtScale1.height,
    renderScale,
  };
}
