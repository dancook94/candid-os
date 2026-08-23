import { ProofError } from "@/lib/proofs/errors";
import { getFileExtension } from "@/lib/proofs/file-validation";
import {
  isAiFileName,
  resolveAiPreflightAvailability,
} from "@/lib/proof-generator/analyse-ai";

export type ArtworkBufferKind = "pdf" | "png" | "jpeg" | "ai_unsupported";

export function detectArtworkBufferKind(buffer: Buffer): ArtworkBufferKind | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "pdf";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }

  return null;
}

function bufferLooksLikeHtml(buffer: Buffer) {
  const head = buffer.subarray(0, 512).toString("utf8").toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("<head") ||
    (head.includes("login") && head.includes("<"))
  );
}

export function assertValidSourceArtworkBuffer(
  buffer: Buffer,
  fileName: string
): ArtworkBufferKind {
  if (!buffer.length) {
    throw new ProofError("Source artwork file is empty.", 400);
  }

  if (bufferLooksLikeHtml(buffer)) {
    throw new ProofError(
      "Source artwork download returned a web page instead of a PDF or image. Re-attach the original artwork from Dropbox.",
      400
    );
  }

  const extension = getFileExtension(fileName);

  if (extension === "ai") {
    const availability = resolveAiPreflightAvailability(buffer, fileName);
    if (availability.kind === "unsupported") {
      return "ai_unsupported";
    }

    return "pdf";
  }

  const detectedKind = detectArtworkBufferKind(buffer);
  if (!detectedKind) {
    throw new ProofError(
      `Source artwork "${fileName}" is not a supported PDF, PNG, or JPEG file.`,
      400
    );
  }

  if (detectedKind === "pdf" && extension !== "pdf" && extension !== "ai") {
    throw new ProofError(
      `Source artwork "${fileName}" does not match the downloaded PDF content.`,
      400
    );
  }

  if (detectedKind === "png" && !["png"].includes(extension)) {
    throw new ProofError(
      `Source artwork "${fileName}" does not match the downloaded PNG content.`,
      400
    );
  }

  if (detectedKind === "jpeg" && !["jpg", "jpeg"].includes(extension)) {
    throw new ProofError(
      `Source artwork "${fileName}" does not match the downloaded JPEG content.`,
      400
    );
  }

  return detectedKind;
}

export function resolveAnalysisBuffer(buffer: Buffer, fileName: string) {
  if (isAiFileName(fileName)) {
    const availability = resolveAiPreflightAvailability(buffer, fileName);
    if (availability.kind === "pdf_compatible") {
      return {
        analysisBuffer: availability.pdfBuffer,
        analysisNote: availability.message,
      };
    }

    return {
      analysisBuffer: buffer,
      analysisNote: availability.message,
    };
  }

  return {
    analysisBuffer: buffer,
    analysisNote: null,
  };
}

export function logProofGeneratorDebug(
  event: string,
  payload: Record<string, unknown>
) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.info("[proof-generator]", event, payload);
}
