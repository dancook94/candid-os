/** Preflight analysis schema version stored with each result. */
export const PROOF_GENERATOR_ANALYSIS_VERSION = "1.0.0";

/** Default maximum source file size for automated analysis (50 MB). Override via env. */
export const DEFAULT_PROOF_GENERATOR_MAX_ANALYSIS_BYTES = 50 * 1024 * 1024;

export function getProofGeneratorMaxAnalysisBytes() {
  const raw = process.env.PROOF_GENERATOR_MAX_ANALYSIS_BYTES;
  if (!raw) {
    return DEFAULT_PROOF_GENERATOR_MAX_ANALYSIS_BYTES;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_PROOF_GENERATOR_MAX_ANALYSIS_BYTES;
}

export function formatProofGeneratorMaxAnalysisLabel() {
  const bytes = getProofGeneratorMaxAnalysisBytes();
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }

  return `${Math.round(bytes / 1024)} KB`;
}

/** Common artwork scale factors compared against quoted finished size. */
export const COMMON_ARTWORK_SCALES = [1, 0.5, 0.25, 0.2, 0.1] as const;

/** Tolerance when matching scaled dimensions (mm). */
export const SIZE_MATCH_TOLERANCE_MM = 2;

/** Points → millimetres (1 pt = 1/72 inch). */
export const PT_TO_MM = 25.4 / 72;

/** Informational low-DPI threshold for large-format (not a pass/fail rule). */
export const LOW_EFFECTIVE_DPI_THRESHOLD = 50;

export const PROOF_GENERATOR_SUPPORTED_EXTENSIONS = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
] as const;

export const PROOF_GENERATOR_UNSUPPORTED_MESSAGE =
  "Export a PDF from Illustrator before generating the automated proof.";

export const PROOF_GENERATOR_OVERSIZE_MESSAGE =
  "This file is too large for automated proof analysis. Create/export a lightweight proof PDF first.";
