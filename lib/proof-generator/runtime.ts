export class ProofGeneratorTimeoutError extends Error {
  readonly stage: string;
  readonly timeoutMs: number;

  constructor(stage: string, timeoutMs: number) {
    super(`${stage} timed out.`);
    this.name = "ProofGeneratorTimeoutError";
    this.stage = stage;
    this.timeoutMs = timeoutMs;
  }
}

export function logProofGeneratorStage(
  stage: string,
  detail?: Record<string, unknown>
) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  if (detail && Object.keys(detail).length > 0) {
    console.info(`[proof-generator] ${stage}`, detail);
  } else {
    console.info(`[proof-generator] ${stage}`);
  }
}

export async function withProofGeneratorTimeout<T>(
  stage: string,
  timeoutMs: number,
  operation: () => Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ProofGeneratorTimeoutError(stage, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function proofGeneratorTimeoutMessage(error: ProofGeneratorTimeoutError) {
  const label = error.stage.toLowerCase();

  if (label.includes("dropbox download") || label.includes("source downloaded")) {
    return "Source artwork download timed out. Check Dropbox connectivity and try again.";
  }

  if (label.includes("dropbox upload")) {
    return "Dropbox upload timed out. The proof PDF may be too large or Dropbox may be slow.";
  }

  if (label.includes("preview render") || label.includes("artwork preview")) {
    return "Artwork preview rendering timed out.";
  }

  if (label.includes("cut-path") || label.includes("cut path")) {
    return "Cut-path extraction timed out — try again or generate without cut overlay.";
  }

  if (label.includes("ocg") || label.includes("suppression")) {
    return "Cut-path preview suppression timed out.";
  }

  if (label.includes("preflight") || label.includes("analysis")) {
    return "Artwork analysis timed out.";
  }

  if (label.includes("pdf generated") || label.includes("pdf generation")) {
    return "Branded proof PDF generation timed out.";
  }

  return `${error.stage} timed out.`;
}

/** Server-side stage timeouts (milliseconds). */
export const PROOF_GENERATOR_TIMEOUTS = {
  dropboxDownloadMs: 120_000,
  dropboxUploadMs: 120_000,
  artworkAnalysisMs: 90_000,
  cutPathExtractionMs: 45_000,
  previewRenderMs: 60_000,
  ocgSuppressionMs: 45_000,
  pdfGenerationMs: 120_000,
  metadataSaveMs: 15_000,
} as const;
