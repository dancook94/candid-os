import { PDFDocument, type PDFEmbeddedPage, type PDFImage } from "pdf-lib";
import sharp from "sharp";

import {
  assertValidSourceArtworkBuffer,
  logProofGeneratorDebug,
} from "@/lib/proof-generator/artwork-buffer";
import { PROOF_PDF_PREVIEW_MAX_PX } from "@/lib/proof-generator/constants";

export type ArtworkPreview =
  | { kind: "image"; image: PDFImage; previewMethod: "sharp_embed_png" | "sharp_embed_jpeg" }
  | {
      kind: "page";
      page: PDFEmbeddedPage;
      width: number;
      height: number;
      previewMethod: "pdf_lib_embed_page";
    };

export async function embedArtworkPreview(
  targetDoc: PDFDocument,
  sourceBuffer: Buffer,
  fileName: string,
  options?: { previewBuffer?: Buffer }
): Promise<ArtworkPreview> {
  const previewBuffer = options?.previewBuffer ?? sourceBuffer;
  const detectedKind = assertValidSourceArtworkBuffer(previewBuffer, fileName);

  logProofGeneratorDebug("artwork_preview_start", {
    fileName,
    detectedKind,
    byteLength: sourceBuffer.length,
    previewByteLength: previewBuffer.length,
  });

  if (detectedKind === "pdf") {
    try {
      const [embeddedPage] = await targetDoc.embedPdf(previewBuffer, [0]);
      if (!embeddedPage) {
        throw new Error("PDF artwork did not contain a renderable first page.");
      }

      return {
        kind: "page",
        page: embeddedPage,
        width: embeddedPage.width,
        height: embeddedPage.height,
        previewMethod: "pdf_lib_embed_page",
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown PDF preview error.";
      throw new Error(`Unable to render PDF artwork preview: ${detail}`);
    }
  }

  try {
    const pngBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize({
        width: PROOF_PDF_PREVIEW_MAX_PX,
        height: PROOF_PDF_PREVIEW_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    const image = await targetDoc.embedPng(pngBuffer);

    return {
      kind: "image",
      image,
      previewMethod: detectedKind === "jpeg" ? "sharp_embed_jpeg" : "sharp_embed_png",
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown image preview error.";
    throw new Error(`Unable to render image artwork preview: ${detail}`);
  }
}
