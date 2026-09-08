import { PDFDocument, type PDFEmbeddedPage, type PDFImage } from "pdf-lib";

import {
  assertValidSourceArtworkBuffer,
  logProofGeneratorDebug,
} from "@/lib/proof-generator/artwork-buffer";
import { resizeImageBufferToPng } from "@/lib/proof-generator/canvas-image";
import { PROOF_PDF_PREVIEW_MAX_PX } from "@/lib/proof-generator/constants";
import { logProofGeneratorStageMarker } from "@/lib/proof-generator/generation-diagnostics";

export type ArtworkPreview =
  | {
      kind: "image";
      image: PDFImage;
      previewMethod: "canvas_embed_png" | "canvas_embed_jpeg" | "pdf_raster_png";
      sourceWidthPt: number;
      sourceHeightPt: number;
    }
  | {
      kind: "page";
      page: PDFEmbeddedPage;
      width: number;
      height: number;
      previewMethod: "pdf_lib_embed_page" | "pdf_lib_embed_page_fallback";
    };

export async function embedArtworkPreview(
  targetDoc: PDFDocument,
  sourceBuffer: Buffer,
  fileName: string,
  options?: {
    previewBuffer?: Buffer;
    rasterizePdf?: boolean;
    requireVisibleText?: boolean;
    pageIndex?: number;
  }
): Promise<ArtworkPreview> {
  const previewBuffer = options?.previewBuffer ?? sourceBuffer;
  const detectedKind = assertValidSourceArtworkBuffer(previewBuffer, fileName);
  const rasterizePdf = options?.rasterizePdf ?? true;
  const pageIndex = options?.pageIndex ?? 0;

  logProofGeneratorDebug("artwork_preview_start", {
    fileName,
    detectedKind,
    byteLength: sourceBuffer.length,
    previewByteLength: previewBuffer.byteLength,
    rasterizePdf,
  });

  if (detectedKind === "pdf" && rasterizePdf) {
    const { rasterizePdfPageToPng, validateFlattenedArtworkPreview } = await import(
      "@/lib/proof-generator/rasterize-pdf-page"
    );
    const raster = await rasterizePdfPageToPng(previewBuffer, pageIndex);
    const previewValidation = await validateFlattenedArtworkPreview({
      sourceBuffer,
      pngBuffer: raster.pngBuffer,
      rgbaData: raster.rgbaData,
      renderedWidthPx: raster.widthPx,
      renderedHeightPx: raster.heightPx,
      requireVisibleText: options?.requireVisibleText,
    });

    if (!previewValidation.ok) {
      throw new Error(previewValidation.reason);
    }

    if (!previewValidation.skipped) {
      logProofGeneratorDebug("artwork_preview_text_validation_passed", {
        fileName,
        darkPixels: previewValidation.darkPixels,
      });
    }

    logProofGeneratorStageMarker("pdf-raster-complete", {
      sourceBufferByteLength: sourceBuffer.byteLength,
      pngBufferByteLength: raster.pngBuffer.byteLength,
      rgbaDataByteLength: raster.rgbaData?.byteLength ?? 0,
      rgbaDataPresent: Boolean(raster.rgbaData?.length),
      renderedWidthPx: raster.widthPx,
      renderedHeightPx: raster.heightPx,
    });

    const image = await targetDoc.embedPng(raster.pngBuffer);

    logProofGeneratorDebug("artwork_preview_rasterized", {
      fileName,
      widthPx: raster.widthPx,
      heightPx: raster.heightPx,
      pageWidthPt: raster.pageWidthPt,
      pageHeightPt: raster.pageHeightPt,
      renderScale: raster.renderScale,
    });

    return {
      kind: "image",
      image,
      previewMethod: "pdf_raster_png",
      sourceWidthPt: raster.pageWidthPt,
      sourceHeightPt: raster.pageHeightPt,
    };
  }

  if (detectedKind === "pdf") {
    const buffersToTry =
      previewBuffer !== sourceBuffer
        ? [{ buffer: previewBuffer, method: "pdf_lib_embed_page" as const }, { buffer: sourceBuffer, method: "pdf_lib_embed_page_fallback" as const }]
        : [{ buffer: sourceBuffer, method: "pdf_lib_embed_page" as const }];

    let lastError: Error | null = null;

    for (const candidate of buffersToTry) {
      try {
        const [embeddedPage] = await targetDoc.embedPdf(candidate.buffer, [pageIndex]);
        if (!embeddedPage) {
          throw new Error(`PDF artwork did not contain a renderable page at index ${pageIndex}.`);
        }

        if (candidate.method === "pdf_lib_embed_page_fallback") {
          logProofGeneratorDebug("artwork_preview_embed_fallback", {
            fileName,
            reason: lastError?.message ?? "preview_buffer_unusable",
          });
        }

        return {
          kind: "page",
          page: embeddedPage,
          width: embeddedPage.width,
          height: embeddedPage.height,
          previewMethod: candidate.method,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown PDF preview error.");
        logProofGeneratorDebug("artwork_preview_embed_failed", {
          fileName,
          previewMethod: candidate.method,
          error: lastError.message,
        });
      }
    }

    throw new Error(
      `Unable to render PDF artwork preview: ${lastError?.message ?? "Unknown PDF preview error."}`,
      { cause: lastError ?? undefined }
    );
  }

  try {
    const pngBuffer = await resizeImageBufferToPng(sourceBuffer, PROOF_PDF_PREVIEW_MAX_PX);
    const image = await targetDoc.embedPng(pngBuffer);

    return {
      kind: "image",
      image,
      previewMethod: detectedKind === "jpeg" ? "canvas_embed_jpeg" : "canvas_embed_png",
      sourceWidthPt: image.width,
      sourceHeightPt: image.height,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown image preview error.";
    throw new Error(`Unable to render image artwork preview: ${detail}`, { cause: error });
  }
}
