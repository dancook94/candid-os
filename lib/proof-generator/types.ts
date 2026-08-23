import type { ProofArtworkOrigin, ProofInternalChecklistKey } from "@/lib/proofs/constants";

export type PreflightOverallStatus = "pass" | "warning" | "manual_review" | "fail";

export type PreflightCheckStatus = "pass" | "warning" | "manual_review" | "info" | "fail";

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
  inputType: "pdf" | "image" | "ai_pdf_compatible" | "ai_unsupported";
  analysisNote?: string | null;
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

export type ProductionFeatureSourceType =
  | "layer"
  | "spot_colour"
  | "separation"
  | "optional_content_group";

export type ProductionFeatureCandidate = {
  name: string;
  sourceType: ProductionFeatureSourceType;
  confidence: DetectedConfidence;
  reason: string;
};

export type ConfirmedProductionFeature = {
  name: string;
  sourceType: ProductionFeatureSourceType;
  confirmedAt: string;
  confirmedByProfileId: string;
  note?: string | null;
};

export type LayerSeparationSummary = {
  name: string;
  sourceType: ProductionFeatureSourceType;
  notes?: string | null;
};

export type SpotColourGroups = {
  productionSeparations: string[];
  otherSpotColours: string[];
};

export type ProductionFeaturesResult = {
  cutPathCandidates: ProductionFeatureCandidate[];
  whiteInkCandidates: ProductionFeatureCandidate[];
  layers: LayerSeparationSummary[];
  spotColourGroups: SpotColourGroups;
  expectsCutPath: boolean;
  cutPathOverlayAvailable: boolean;
  cutPathOverlayReason?: string | null;
  cutPathOverlayRequested?: boolean;
  cutPathOverlayGeometryAvailable?: boolean;
  cutPathOverlayRendered?: boolean;
  confirmedCutPath?: ConfirmedProductionFeature | null;
  noCutLineRequired?: boolean;
  cutPathRequiredNotDetected?: boolean;
  showCutPathOnProof?: boolean;
  confirmedWhiteInk?: ConfirmedProductionFeature | null;
  noWhiteInkRequired?: boolean;
};

export type FontPreflightStatus = "all_outlined" | "live_fonts_detected" | "unknown";

export type FontPreflightResult = {
  status: FontPreflightStatus;
  names: string[];
  confidence: DetectedConfidence;
  message: string;
};

export type ImageLinkStatus =
  | "embedded"
  | "external_links_detected"
  | "missing_links_detected"
  | "unknown";

export type ImagePreflightResult = {
  count: number;
  linkStatus: ImageLinkStatus;
  missingLinks: string[];
  confidence: DetectedConfidence;
  message: string;
};

export type PreflightOperatorConfirmation = {
  cutPath?: {
    decision: "confirmed" | "no_cut_required" | "required_not_detected";
    confirmedCandidateName?: string | null;
    confirmedSourceType?: ProductionFeatureSourceType | null;
    showOnCustomerProof?: boolean;
    note?: string | null;
  };
  whiteInk?: {
    decision: "confirmed" | "not_required";
    confirmedCandidateName?: string | null;
    confirmedSourceType?: ProductionFeatureSourceType | null;
    note?: string | null;
  };
  checklist?: Partial<
    Record<
      | "bleed_trim_checked"
      | "spelling_content_checked"
      | "material_specification_checked",
      boolean
    >
  >;
  missingLinkOverrideReason?: string | null;
};

export type SizeComparisonResult = {
  quotedWidthMm: number | null;
  quotedHeightMm: number | null;
  detectedWidthMm: number | null;
  detectedHeightMm: number | null;
  matchedScale: number | null;
  matchedScaleLabel: string | null;
  widthScalePercent: number | null;
  heightScalePercent: number | null;
  aspectRatioMatches: boolean;
  rotationMatches: boolean;
  comparisonStatus: "pass" | "warning" | "manual_review";
  expectedFinishedWidthMm: number | null;
  expectedFinishedHeightMm: number | null;
  artworkResolutionDpi: number | null;
  effectiveResolutionDpi: number | null;
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
  productionFeatures: ProductionFeaturesResult;
  fonts: FontPreflightResult;
  images: ImagePreflightResult;
  sourceReference: {
    dropboxPath: string | null;
    fileName: string;
    fileSizeBytes: number;
    mimeType: string | null;
  };
};

export type PreflightManualOverrides = {
  operatorConfirmation?: PreflightOperatorConfirmation | null;
  entries?: Record<string, { value: string; reason?: string | null }>;
};

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
