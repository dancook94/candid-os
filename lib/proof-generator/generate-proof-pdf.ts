import { PDFDocument, StandardFonts } from "pdf-lib";

import { CutPathGeometryCache } from "@/lib/proof-generator/cut-path-geometry-cache";
import { logDiagnosticStage } from "@/lib/proof-generator/diagnostic-stage-log";
import { embedArtworkPreview } from "@/lib/proof-generator/artwork-preview";
import { logProofGeneratorDebug } from "@/lib/proof-generator/artwork-buffer";
import {
  logProofGeneratorStage,
  PROOF_GENERATOR_TIMEOUTS,
  withProofGeneratorTimeout,
} from "@/lib/proof-generator/runtime";
import {
  drawCutPathOverlay,
  drawCutPathOverlayLegend,
} from "@/lib/proof-generator/cut-path-overlay";
import { cutPathGeometryHasContent } from "@/lib/proof-generator/extract-cut-path-geometry";
import { createCustomerPreviewPdfBuffer } from "@/lib/proof-generator/suppress-cut-path-preview";
import type { SuppressCutPathPreviewResult } from "@/lib/proof-generator/suppress-cut-path-preview";
import {
  PROOF_PDF_MARGIN,
  PROOF_PDF_PAGE_HEIGHT,
  PROOF_PDF_PAGE_WIDTH,
} from "@/lib/proof-generator/pdf-brand";
import {
  drawApprovalFooterBar,
  drawArtworkPreviewFrame,
  drawCustomerMessagePanel,
  drawMetaGrid,
  drawProofHeroTitle,
  drawProofPageHeader,
  drawProofVersionSubtitle,
  embedCandidLogo,
  estimateWrappedLineCount,
} from "@/lib/proof-generator/pdf-layout";
import {
  renderSpecificationPages,
  updateProofPageIndicators,
} from "@/lib/proof-generator/pdf-spec-pages";
import { joinPdfParts, PDF_NOT_SPECIFIED } from "@/lib/proof-generator/pdf-text";
import type { PreflightResult } from "@/lib/proof-generator/types";
import { buildCustomerProofPdfFileName } from "@/lib/proofs/dropbox";

const FOOTER_BAR_HEIGHT = 34;
const FOOTER_GAP = 8;

function contentWidth() {
  return PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN * 2;
}

export async function generateCustomerProofPdf(input: {
  jobReference: string;
  projectName: string;
  proofReference: string;
  versionNumber: number;
  customerMessage?: string | null;
  preflight: PreflightResult;
  sourceBuffer: Buffer;
  sourceFileName: string;
  cutPathGeometryCache?: CutPathGeometryCache;
}) {
  try {
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fonts = { regular, bold };
    const logo = await embedCandidLogo(doc);

    logProofGeneratorDebug("proof_pdf_logo_embedded", {
      displayWidthPt: logo.width,
      rasterWidthPx: logo.rasterWidth,
    });

    const primaryItem = input.preflight.quotedItems[0] ?? null;
    const customerMessage = input.customerMessage?.trim() ?? "";

    const page1 = doc.addPage([PROOF_PDF_PAGE_WIDTH, PROOF_PDF_PAGE_HEIGHT]);
    const page1Header = drawProofPageHeader(page1, fonts, logo, 1, 1, {
      showPageIndicator: false,
    });
    let y = drawProofHeroTitle(page1, fonts, page1Header.dividerY);
    y = drawProofVersionSubtitle(page1, fonts, y, input.versionNumber);

    y = drawMetaGrid(page1, fonts, y, [
      { label: "Job", value: input.jobReference },
      { label: "Project", value: input.projectName },
      {
        label: "Proof version",
        value: String(input.versionNumber),
      },
      {
        label: "Related item",
        value: primaryItem
          ? joinPdfParts([primaryItem.itemReference, primaryItem.itemName], " | ", PDF_NOT_SPECIFIED)
          : PDF_NOT_SPECIFIED,
      },
    ]);

    const footerTop = PROOF_PDF_MARGIN + FOOTER_BAR_HEIGHT + FOOTER_GAP;
    const customerMessageLines = customerMessage
      ? estimateWrappedLineCount(customerMessage, contentWidth() - 24, regular, 10)
      : 0;
    const customerMessageHeight = customerMessage
      ? 32 + customerMessageLines * 12 + 8
      : 0;
    const previewBoxBottom = footerTop + customerMessageHeight + 6;
    const previewBoxHeight = Math.max(260, y - 8 - previewBoxBottom);
    const previewBoxWidth = contentWidth();

    const overlayRequestedInitial = Boolean(
      input.preflight.productionFeatures.showCutPathOnProof &&
        input.preflight.productionFeatures.confirmedCutPath
    );

    let previewSource: SuppressCutPathPreviewResult = {
      buffer: input.sourceBuffer,
      originalCutPathSuppressed: false,
      method: "none",
    };

    if (overlayRequestedInitial) {
      logDiagnosticStage("20", "original cut-path suppression started", {
        sourceFileName: input.sourceFileName,
      });
      try {
        previewSource = await createCustomerPreviewPdfBuffer(
          input.sourceBuffer,
          input.preflight.productionFeatures.confirmedCutPath ?? null
        );
      } catch (error) {
        logProofGeneratorDebug("cut_path_preview_suppression_failed", {
          sourceFileName: input.sourceFileName,
          error: error instanceof Error ? error.message : String(error),
        });
        previewSource = {
          buffer: input.sourceBuffer,
          originalCutPathSuppressed: false,
          method: "none",
        };
      }
      logDiagnosticStage("21", "original cut-path suppression completed/fallback", {
        sourceFileName: input.sourceFileName,
        method: previewSource.method,
        suppressed: previewSource.originalCutPathSuppressed,
      });
    }

    logProofGeneratorStage("preview render started", {
      sourceFileName: input.sourceFileName,
      suppressionMethod: previewSource.method,
    });

    logDiagnosticStage("18", "artwork preview rendering started", {
      sourceFileName: input.sourceFileName,
    });

    const preview = await withProofGeneratorTimeout(
      "Preview render",
      PROOF_GENERATOR_TIMEOUTS.previewRenderMs,
      () =>
        embedArtworkPreview(doc, input.sourceBuffer, input.sourceFileName, {
          previewBuffer: previewSource.buffer,
        })
    );

    logProofGeneratorStage("preview render complete", {
      sourceFileName: input.sourceFileName,
      previewMethod: preview.previewMethod,
    });
    logDiagnosticStage("19", "artwork preview rendering completed", {
      sourceFileName: input.sourceFileName,
      previewMethod: preview.previewMethod,
    });

    logProofGeneratorDebug("artwork_preview_embedded", {
      sourceFileName: input.sourceFileName,
      previewMethod: preview.previewMethod,
      previewKind: preview.kind,
      previewPixelWidth:
        preview.kind === "image" ? preview.image.width : Math.round(preview.width),
      previewPixelHeight:
        preview.kind === "image" ? preview.image.height : Math.round(preview.height),
    });

    const preflight = { ...input.preflight };
    const features = { ...preflight.productionFeatures };
    let cutPathOverlayRendered = false;
    let cutPathOverlayGeometryAvailable = false;

    const placement = drawArtworkPreviewFrame(page1, {
      x: PROOF_PDF_MARGIN,
      y: previewBoxBottom,
      width: previewBoxWidth,
      height: previewBoxHeight,
      preview:
        preview.kind === "image"
          ? {
              kind: "image",
              image: preview.image,
              imageWidth: preview.image.width,
              imageHeight: preview.image.height,
            }
          : {
              kind: "page",
              page: preview.page,
              pageWidth: preview.width,
              pageHeight: preview.height,
            },
    });

    const overlayRequested = Boolean(
      features.showCutPathOnProof && features.confirmedCutPath && preview.kind === "page"
    );
    features.cutPathOverlayRequested = overlayRequested;
    features.originalCutPathSuppressed = previewSource.originalCutPathSuppressed;

    if (overlayRequested && features.confirmedCutPath) {
      logDiagnosticStage("22", "overlay drawing started", {
        sourceFileName: input.sourceFileName,
        cutPathName: features.confirmedCutPath.name,
      });
      const confirmedCutPath = features.confirmedCutPath;
      const geometryCache = input.cutPathGeometryCache ?? new CutPathGeometryCache();
      const extraction = await geometryCache.extract(
        input.sourceBuffer,
        confirmedCutPath.name,
        0,
        { debugLabel: "customer_proof_pdf_overlay" }
      );

      cutPathOverlayGeometryAvailable =
        extraction.ok && cutPathGeometryHasContent(extraction.geometry);
      features.cutPathOverlayGeometryAvailable = cutPathOverlayGeometryAvailable;

      if (cutPathOverlayGeometryAvailable && extraction.ok) {
        cutPathOverlayRendered = drawCutPathOverlay(page1, extraction.geometry, placement);
        if (cutPathOverlayRendered) {
          const cutPathSize = features.cutPathSize ?? features.resolvedProductionFinishedSize;
          drawCutPathOverlayLegend(
            page1,
            fonts,
            PROOF_PDF_MARGIN + 8,
            previewBoxBottom - 14,
            {
              finishedCutSizeLabel: cutPathSize
                ? `${cutPathSize.widthMm} x ${cutPathSize.heightMm} mm`
                : null,
            }
          );
        }
      }

      logProofGeneratorDebug("cut_path_overlay_render", {
        requested: overlayRequested,
        separationName: confirmedCutPath.name,
        extracted: extraction.ok,
        geometryAvailable: cutPathOverlayGeometryAvailable,
        rendered: cutPathOverlayRendered,
        originalCutPathSuppressed: previewSource.originalCutPathSuppressed,
        previewSuppressionMethod: previewSource.method,
      });

      logProofGeneratorStage("overlay rendered", {
        sourceFileName: input.sourceFileName,
        rendered: cutPathOverlayRendered,
        geometryAvailable: cutPathOverlayGeometryAvailable,
      });
      logDiagnosticStage("23", "overlay drawing completed", {
        sourceFileName: input.sourceFileName,
        rendered: cutPathOverlayRendered,
      });
    }

    features.cutPathOverlayRendered =
      overlayRequested && cutPathOverlayGeometryAvailable && cutPathOverlayRendered;
    preflight.productionFeatures = features;

    if (customerMessage) {
      drawCustomerMessagePanel(page1, fonts, {
        message: customerMessage,
        x: PROOF_PDF_MARGIN,
        y: footerTop + customerMessageHeight,
        width: previewBoxWidth,
      });
    }

    drawApprovalFooterBar(
      page1,
      fonts,
      "Please review this proof carefully before approval.",
      "Candid Creative"
    );

    renderSpecificationPages(doc, fonts, logo, preflight);

    updateProofPageIndicators(doc.getPages(), fonts, 1);

    input.preflight.productionFeatures = features;

    const bytes = await doc.save();
    return Buffer.from(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown PDF generation error.";
    throw new Error(`Branded proof PDF generation failed: ${detail}`);
  }
}

export function buildGeneratedProofFileName(
  proofReference: string,
  versionNumber: number,
  itemReference?: string | null,
  jobReference?: string | null
) {
  return buildCustomerProofPdfFileName({
    versionNumber,
    itemReference,
    jobReference: jobReference ?? proofReference.split(" Proof ")[0] ?? proofReference,
  });
}
