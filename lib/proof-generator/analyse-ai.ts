export type AiPreflightAvailability =
  | {
      kind: "pdf_compatible";
      pdfBuffer: Buffer;
      message: string;
    }
  | {
      kind: "unsupported";
      message: string;
    };

const AI_UNSUPPORTED_MESSAGE =
  "Advanced preflight is unavailable for this Illustrator file. Export a PDF-compatible copy for analysis.";

function findPdfStart(buffer: Buffer) {
  const searchLimit = Math.min(buffer.length, 8 * 1024 * 1024);
  const text = buffer.subarray(0, searchLimit).toString("latin1");
  return text.indexOf("%PDF-");
}

export function resolveAiPreflightAvailability(
  buffer: Buffer,
  fileName: string
): AiPreflightAvailability {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return {
      kind: "pdf_compatible",
      pdfBuffer: buffer,
      message: `PDF-compatible Illustrator artwork detected in ${fileName}.`,
    };
  }

  const pdfStart = findPdfStart(buffer);
  if (pdfStart >= 0) {
    return {
      kind: "pdf_compatible",
      pdfBuffer: buffer.subarray(pdfStart),
      message: `Embedded PDF-compatible stream detected in ${fileName}.`,
    };
  }

  return {
    kind: "unsupported",
    message: AI_UNSUPPORTED_MESSAGE,
  };
}

export function isAiFileName(fileName: string) {
  return fileName.toLowerCase().endsWith(".ai");
}
