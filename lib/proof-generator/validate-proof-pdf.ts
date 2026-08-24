import { PDFDocument } from "pdf-lib";

export type ProofPdfValidationResult =
  | { ok: true; pageCount: number }
  | { ok: false; reason: string };

/**
 * Independent round-trip parse check for generated customer proofs.
 * Catches structurally invalid output before upload.
 */
export async function validateGeneratedProofPdf(
  pdfBuffer: Buffer
): Promise<ProofPdfValidationResult> {
  try {
    const document = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const pageCount = document.getPageCount();

    if (pageCount < 1) {
      return { ok: false, reason: "Generated proof PDF contains no pages." };
    }

    const roundTripBytes = await document.save();
    const roundTrip = await PDFDocument.load(roundTripBytes, { ignoreEncryption: true });

    if (roundTrip.getPageCount() !== pageCount) {
      return {
        ok: false,
        reason: "Generated proof PDF failed an independent re-parse round trip.",
      };
    }

    return { ok: true, pageCount };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Generated proof PDF could not be parsed.";
    return { ok: false, reason: message };
  }
}
