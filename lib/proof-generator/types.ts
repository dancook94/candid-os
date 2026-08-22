import type { ProofArtworkOrigin, ProofInternalChecklistKey } from "@/lib/proofs/constants";

export type PreflightOverallStatus = "pass" | "warning" | "manual_review";

export type PreflightCheckStatus = "pass" | "warning" | "manual_review" | "info";

export type DetectedConfidence = "high" | "medium" | "low";

export type DetectedValue<T = string | number | null> = {
  value: T;
  confidence: DetectedConfidence;
  source: string;
};

export type QuotedSpecificationItem = {
  id: string;
  itemReference: string | null;
  itemName: string;
  description: string | null;
  quantity: number | null;
  quotedWidthMm: number | null;
  quotedHeightMm: number | null;
  material: string | null;
  printSpecification: string | null;
  sides: string | null;
  finishing: string | null;
  notes: string | null;
};

export type PdfBoxDimensions = {
  widthPt: number;
  heightPt: number;
  widthMm: number;
  heightMm: number;
};

export type DetectedArtworkMetadata = {
  fileName: string;
  fileSizeBytes: number;
  mimeType: string | null;
  inputType: "pdf" | "image";
  pageCount: number | null;
  pdfVersion: DetectedValue<string | null>;
  pageSize: DetectedValue<PdfBoxDimensions | null>;
  orientation: DetectedValue<"portrait" | "landscape" | "square" | null>;
  mediaBox: DetectedValue<PdfBoxDimensions | null>;
  cropBox: DetectedValue<PdfBoxDimensions | null>;
  trimBox: DetectedValue<PdfBoxDimensions | null>;
  bleedBox: DetectedValue<PdfBoxDimensions | null>;
  artBox: DetectedValue<PdfBoxDimensions | null>;
  colourMode: DetectedValue<
    "CMYK" | "RGB" | "Mixed" | "Grayscale" | "Unknown" | null
  >;
  cmykPresent: DetectedValue<boolean>;
  rgbPresent: DetectedValue<boolean>;
  grayscalePresent: DetectedValue<boolean>;
  spotColourNames: DetectedValue<string[]>;
  fonts: DetectedValue<string[]>;
  rasterImages: DetectedValue<
    Array<{
      widthPx: number;
      heightPx: number;
      effectiveDpiAtArtworkSize: number | null;
      effectiveDpiAtFinishedSize: number | null;
    }>
  >;
  imageWidthPx: DetectedValue<number | null>;
  imageHeightPx: DetectedValue<number | null>;
};

export type SizeComparisonResult = {
  quotedWidthMm: number | null;
  quotedHeightMm: number | null;
  detectedWidthMm: number | null;
  detectedHeightMm: number | null;
  matchedScale: number | null;
  matchedScaleLabel: string | null;
  aspectRatioMatches: boolean;
  rotationMatches: boolean;
  expectedFinishedWidthMm: number | null;
  expectedFinishedHeightMm: number | null;
  message: string;
};

export type PreflightCheck = {
  key: string;
  label: string;
  status: PreflightCheckStatus;
  detectedValue: string | null;
  expectedValue: string | null;
  message: string;
  confidence: DetectedConfidence;
};

export type PreflightResult = {
  analysisVersion: string;
  overallStatus: PreflightOverallStatus;
  checks: PreflightCheck[];
  metadata: DetectedArtworkMetadata;
  sizeComparison: SizeComparisonResult | null;
  quotedItems: QuotedSpecificationItem[];
  sourceReference: {
    dropboxPath: string | null;
    fileName: string;
    fileSizeBytes: number;
    mimeType: string | null;
  };
};

export type PreflightManualOverrides = Record<
  string,
  { value: string; reason?: string | null }
>;

export type GenerateProofInput = {
  jobId: string;
  productionItemIds: string[];
  title: string;
  customerMessage?: string | null;
  internalNote?: string | null;
  artworkOrigin: ProofArtworkOrigin;
  sourceDropboxPath?: string | null;
  sourceJobFileId?: string | null;
  preflightResult: PreflightResult;
  manualOverrides?: PreflightManualOverrides;
  warningsReviewed?: Partial<Record<string, boolean>>;
  checklistAcknowledgements?: Partial<Record<ProofInternalChecklistKey, boolean>>;
  reviseProofId?: string | null;
};

export type ArtworkSourceInput =
  | {
      type: "dropbox_path";
      dropboxPath: string;
      fileName: string;
    }
  | {
      type: "job_file";
      jobFileId: string;
    }
  | {
      type: "upload";
      fileName: string;
      mimeType: string | null;
    };
