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
import {
  PROOF_PDF_MARGIN,
  PROOF_PDF_PAGE_HEIGHT,
  PROOF_PDF_PAGE_WIDTH,
} from "@/lib/proof-generator/pdf-brand";
import {
  drawApprovalFooterBar,
  drawArtworkPreviewFrame,
  drawArtworkPageSubtitle,
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
import { resolveCustomerArtworkPreviewBuffer } from "@/lib/proof-generator/suppress-cut-path-preview";
import { validateGeneratedProofPdf } from "@/lib/proof-generator/validate-proof-pdf";
import { resolvePreflightChecksAfterProductionConfirmation } from "@/lib/proof-generator/warnings";
import { buildCustomerProofPdfFileName } from "@/lib/proofs/dropbox";
import {
  logOriginalGenerationError,
  logProofGeneratorStageMarker,
  PROOF_GENERATOR_DIAGNOSTICS_V2,
  wrapProofGenerationError,
} from "@/lib/proof-generator/generation-diagnostics";
import { detectArtworkBufferKind } from "@/lib/proof-generator/artwork-buffer";

const FOOTER_BAR_HEIGHT = 34;
const FOOTER_GAP = 8;
const CUSTOMER_MESSAGE_FOOTER_GAP = 8;
const CUT_PATH_LEGEND_HEIGHT = 24;
const CUT_PATH_LEGEND_PREVIEW_GAP = 6;

function contentWidth() {
  return PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN * 2;
}

function getSourcePdfPageCount(preflight: PreflightResult) {
  if (preflight.metadata.inputType !== "pdf") {
    return 1;
  }

  const pageCount = preflight.metadata.pageCount ?? 1;
  return pageCount > 1 ? pageCount : 1;
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
  const sourcePageCount = getSourcePdfPageCount(input.preflight);
  if (sourcePageCount > 1) {
    return generateMultiPageCustomerProofPdf(input, sourcePageCount);
  }

  try {
    logProofGeneratorStageMarker("entered-generator", {
      sourceFileName: input.sourceFileName,
      sourceType: detectArtworkBufferKind(input.sourceBuffer),
      sourceBufferByteLength: input.sourceBuffer.byteLength,
      diagnosticsVersion: PROOF_GENERATOR_DIAGNOSTICS_V2,
    });

    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fonts = { regular, bold };

    logProofGeneratorStageMarker("logo-start");
    const logo = await embedCandidLogo(doc);
    logProofGeneratorStageMarker("logo-complete", {
      logoDisplayWidthPt: logo.width,
      logoRasterWidthPx: logo.rasterWidth,
    });

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

    const overlayRequestedInitial = Boolean(
      input.preflight.productionFeatures.showCutPathOnProof &&
        input.preflight.productionFeatures.confirmedCutPath
    );
    const cutPathLegendReserved = overlayRequestedInitial
      ? CUT_PATH_LEGEND_HEIGHT + CUT_PATH_LEGEND_PREVIEW_GAP
      : 0;

    const footerTop = PROOF_PDF_MARGIN + FOOTER_BAR_HEIGHT + FOOTER_GAP;
    const customerMessageLines = customerMessage
      ? estimateWrappedLineCount(customerMessage, contentWidth() - 24, regular, 10)
      : 0;
    const customerMessageHeight = customerMessage
      ? 32 + customerMessageLines * 12 + CUSTOMER_MESSAGE_FOOTER_GAP
      : 0;
    const previewBoxBottom =
      footerTop + customerMessageHeight + cutPathLegendReserved;
    const previewBoxHeight = Math.max(260, y - 8 - previewBoxBottom);
    const previewBoxWidth = contentWidth();

    logProofGeneratorStage("preview render started", {
      sourceFileName: input.sourceFileName,
      previewPipeline: "flattened_raster",
    });

    logDiagnosticStage("18", "artwork preview rendering started", {
      sourceFileName: input.sourceFileName,
    });

    const requireVisibleText = (input.preflight.fonts.names?.length ?? 0) > 0;
    const confirmedCutPathForPreview = input.preflight.productionFeatures.confirmedCutPath ?? null;

    logProofGeneratorStageMarker("preview-resolve-start", {
      sourceBufferByteLength: input.sourceBuffer.byteLength,
    });
    const previewSource = await withProofGeneratorTimeout(
      "Cut-path preview suppression",
      PROOF_GENERATOR_TIMEOUTS.ocgSuppressionMs,
      () =>
        resolveCustomerArtworkPreviewBuffer(input.sourceBuffer, confirmedCutPathForPreview, {
          requireVisibleText,
        })
    );

    logProofGeneratorDebug("cut_path_preview_suppression", {
      sourceFileName: input.sourceFileName,
      originalCutPathSuppressed: previewSource.originalCutPathSuppressed,
      method: previewSource.method,
      suppressionReason: previewSource.suppressionReason ?? null,
    });

    logProofGeneratorStageMarker("preview-resolve-complete", {
      sourceBufferByteLength: input.sourceBuffer.byteLength,
      previewBufferByteLength: previewSource.previewBuffer.byteLength,
      originalCutPathSuppressed: previewSource.originalCutPathSuppressed,
      suppressionMethod: previewSource.method,
    });

    logProofGeneratorStageMarker("artwork-embed-start", {
      sourceBufferByteLength: input.sourceBuffer.byteLength,
      previewBufferByteLength: previewSource.previewBuffer.byteLength,
    });
    const preview = await withProofGeneratorTimeout(
      "Preview render",
      PROOF_GENERATOR_TIMEOUTS.previewRenderMs,
      () =>
        embedArtworkPreview(doc, input.sourceBuffer, input.sourceFileName, {
          previewBuffer: previewSource.previewBuffer,
          rasterizePdf: true,
          requireVisibleText,
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

    logProofGeneratorStageMarker("artwork-embed-complete", {
      previewMethod: preview.previewMethod,
      previewKind: preview.kind,
      previewPixelWidth:
        preview.kind === "image" ? preview.image.width : Math.round(preview.width),
      previewPixelHeight:
        preview.kind === "image" ? preview.image.height : Math.round(preview.height),
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
              imageWidth: preview.sourceWidthPt,
              imageHeight: preview.sourceHeightPt,
            }
          : {
              kind: "page",
              page: preview.page,
              pageWidth: preview.width,
              pageHeight: preview.height,
            },
    });

    const overlayRequested = Boolean(
      features.showCutPathOnProof && features.confirmedCutPath
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
      }

      logProofGeneratorDebug("cut_path_overlay_render", {
        requested: overlayRequested,
        separationName: confirmedCutPath.name,
        extracted: extraction.ok,
        geometryAvailable: cutPathOverlayGeometryAvailable,
        rendered: cutPathOverlayRendered,
        previewPipeline: "flattened_raster",
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

    logProofGeneratorStageMarker("overlay-complete", {
      overlayRequested,
      cutPathOverlayRendered: features.cutPathOverlayRendered,
      cutPathOverlayGeometryAvailable,
    });

    preflight.productionFeatures = features;
    preflight.checks = resolvePreflightChecksAfterProductionConfirmation(
      preflight.checks,
      features
    );

    if (overlayRequestedInitial && features.confirmedCutPath && features.showCutPathOnProof) {
      const cutPathSize = features.cutPathSize ?? features.resolvedProductionFinishedSize;
      const customerMessageTop = footerTop + customerMessageHeight;
      const legendBaselineY = customerMessageTop + CUT_PATH_LEGEND_PREVIEW_GAP + 18;
      drawCutPathOverlayLegend(page1, fonts, PROOF_PDF_MARGIN + 8, legendBaselineY, {
        finishedCutSizeLabel: cutPathSize
          ? `${cutPathSize.widthMm} × ${cutPathSize.heightMm} mm`
          : null,
      });
    }

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

    logProofGeneratorStageMarker("spec-pages-complete", {
      pageCount: doc.getPageCount(),
    });

    updateProofPageIndicators(doc.getPages(), fonts, 1);

    input.preflight.productionFeatures = features;
    input.preflight.checks = preflight.checks;

    logProofGeneratorStageMarker("save-start", {
      pageCount: doc.getPageCount(),
    });
    const bytes = await doc.save();
    const pdfBuffer = Buffer.from(bytes);

    logProofGeneratorStageMarker("save-complete", {
      pdfBufferByteLength: pdfBuffer.byteLength,
      pageCount: doc.getPageCount(),
    });

    const validation = await validateGeneratedProofPdf(pdfBuffer);
    if (!validation.ok) {
      throw new Error(`Generated proof PDF failed validation: ${validation.reason}`);
    }

    logProofGeneratorStageMarker("validation-complete", {
      pageCount: validation.pageCount,
    });

    logProofGeneratorDebug("proof_pdf_validated", {
      sourceFileName: input.sourceFileName,
      pageCount: validation.pageCount,
    });

    return pdfBuffer;
  } catch (error) {
    logOriginalGenerationError(error, { stage: "generateCustomerProofPdf-catch" });
    const detail = error instanceof Error ? error.message : "Unknown PDF generation error.";
    throw wrapProofGenerationError(
      `Branded proof PDF generation failed: ${detail}`,
      error
    );
  }
}

async function generateMultiPageCustomerProofPdf(
  input: {
    jobReference: string;
    projectName: string;
    proofReference: string;
    versionNumber: number;
    customerMessage?: string | null;
    preflight: PreflightResult;
    sourceBuffer: Buffer;
    sourceFileName: string;
    cutPathGeometryCache?: CutPathGeometryCache;
  },
  sourcePageCount: number
) {
  try {
    logProofGeneratorStageMarker("multi-page-proof-start", {
      sourceFileName: input.sourceFileName,
      sourcePageCount,
      diagnosticsVersion: PROOF_GENERATOR_DIAGNOSTICS_V2,
    });

    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fonts = { regular, bold };
    const logo = await embedCandidLogo(doc);

    const primaryItem = input.preflight.quotedItems[0] ?? null;
    const customerMessage = input.customerMessage?.trim() ?? "";
    const preflight = { ...input.preflight };
    const features = { ...preflight.productionFeatures };
    const requireVisibleText = (input.preflight.fonts.names?.length ?? 0) > 0;
    const confirmedCutPathForPreview = input.preflight.productionFeatures.confirmedCutPath ?? null;
    const overlayRequestedInitial = Boolean(
      input.preflight.productionFeatures.showCutPathOnProof &&
        input.preflight.productionFeatures.confirmedCutPath
    );

    for (let pageIndex = 0; pageIndex < sourcePageCount; pageIndex += 1) {
      const pageNumber = pageIndex + 1;
      const isFirstPage = pageIndex === 0;
      const startedAt = Date.now();

      logProofGeneratorStageMarker("artwork-page-start", {
        pageIndex,
        pageNumber,
        sourcePageCount,
        sourceFileName: input.sourceFileName,
      });

      const page = doc.addPage([PROOF_PDF_PAGE_WIDTH, PROOF_PDF_PAGE_HEIGHT]);
      const pageHeader = drawProofPageHeader(page, fonts, logo, pageNumber, pageNumber, {
        showPageIndicator: false,
      });

      let y = pageHeader.contentStartY;
      if (isFirstPage) {
        y = drawProofHeroTitle(page, fonts, pageHeader.dividerY);
        y = drawProofVersionSubtitle(page, fonts, y, input.versionNumber);
        y = drawMetaGrid(page, fonts, y, [
          { label: "Job", value: input.jobReference },
          { label: "Project", value: input.projectName },
          { label: "Proof version", value: String(input.versionNumber) },
          {
            label: "Related item",
            value: primaryItem
              ? joinPdfParts(
                  [primaryItem.itemReference, primaryItem.itemName],
                  " | ",
                  PDF_NOT_SPECIFIED
                )
              : PDF_NOT_SPECIFIED,
          },
          { label: "Artwork page", value: `${pageNumber} of ${sourcePageCount}` },
        ]);
      } else {
        y = drawArtworkPageSubtitle(page, fonts, y, pageNumber, sourcePageCount);
        y = drawMetaGrid(page, fonts, y, [
          { label: "Job", value: input.jobReference },
          { label: "Project", value: input.projectName },
          { label: "Artwork page", value: `${pageNumber} of ${sourcePageCount}` },
        ]);
      }

      const cutPathLegendReserved =
        isFirstPage && overlayRequestedInitial
          ? CUT_PATH_LEGEND_HEIGHT + CUT_PATH_LEGEND_PREVIEW_GAP
          : 0;
      const footerTop = PROOF_PDF_MARGIN + FOOTER_BAR_HEIGHT + FOOTER_GAP;
      const customerMessageLines =
        isFirstPage && customerMessage
          ? estimateWrappedLineCount(customerMessage, contentWidth() - 24, regular, 10)
          : 0;
      const customerMessageHeight =
        isFirstPage && customerMessage
          ? 32 + customerMessageLines * 12 + CUSTOMER_MESSAGE_FOOTER_GAP
          : 0;
      const previewBoxBottom = footerTop + customerMessageHeight + cutPathLegendReserved;
      const previewBoxHeight = Math.max(260, y - 8 - previewBoxBottom);
      const previewBoxWidth = contentWidth();

      let preview;
      if (isFirstPage) {
        const previewSource = await withProofGeneratorTimeout(
          "Cut-path preview suppression",
          PROOF_GENERATOR_TIMEOUTS.ocgSuppressionMs,
          () =>
            resolveCustomerArtworkPreviewBuffer(input.sourceBuffer, confirmedCutPathForPreview, {
              requireVisibleText,
            })
        );

        features.originalCutPathSuppressed = previewSource.originalCutPathSuppressed;

        preview = await withProofGeneratorTimeout(
          `Preview render (page ${pageNumber})`,
          PROOF_GENERATOR_TIMEOUTS.previewRenderMs,
          () =>
            embedArtworkPreview(doc, input.sourceBuffer, input.sourceFileName, {
              previewBuffer: previewSource.previewBuffer,
              rasterizePdf: true,
              requireVisibleText,
              pageIndex: 0,
            })
        );
      } else {
        preview = await withProofGeneratorTimeout(
          `Preview render (page ${pageNumber})`,
          PROOF_GENERATOR_TIMEOUTS.previewRenderMs,
          () =>
            embedArtworkPreview(doc, input.sourceBuffer, input.sourceFileName, {
              rasterizePdf: true,
              requireVisibleText: false,
              pageIndex,
            })
        );
      }

      const placement = drawArtworkPreviewFrame(page, {
        x: PROOF_PDF_MARGIN,
        y: previewBoxBottom,
        width: previewBoxWidth,
        height: previewBoxHeight,
        preview:
          preview.kind === "image"
            ? {
                kind: "image",
                image: preview.image,
                imageWidth: preview.sourceWidthPt,
                imageHeight: preview.sourceHeightPt,
              }
            : {
                kind: "page",
                page: preview.page,
                pageWidth: preview.width,
                pageHeight: preview.height,
              },
      });

      if (isFirstPage) {
        const overlayRequested = Boolean(features.showCutPathOnProof && features.confirmedCutPath);
        features.cutPathOverlayRequested = overlayRequested;

        if (overlayRequested && features.confirmedCutPath) {
          const confirmedCutPath = features.confirmedCutPath;
          const geometryCache = input.cutPathGeometryCache ?? new CutPathGeometryCache();
          const extraction = await geometryCache.extract(
            input.sourceBuffer,
            confirmedCutPath.name,
            0,
            { debugLabel: "customer_proof_pdf_overlay" }
          );

          const cutPathOverlayGeometryAvailable =
            extraction.ok && cutPathGeometryHasContent(extraction.geometry);
          features.cutPathOverlayGeometryAvailable = cutPathOverlayGeometryAvailable;

          const cutPathOverlayRendered =
            cutPathOverlayGeometryAvailable && extraction.ok
              ? drawCutPathOverlay(page, extraction.geometry, placement)
              : false;

          features.cutPathOverlayRendered =
            overlayRequested && cutPathOverlayGeometryAvailable && cutPathOverlayRendered;
        }

        if (overlayRequestedInitial && features.confirmedCutPath && features.showCutPathOnProof) {
          const cutPathSize = features.cutPathSize ?? features.resolvedProductionFinishedSize;
          const customerMessageTop = footerTop + customerMessageHeight;
          const legendBaselineY = customerMessageTop + CUT_PATH_LEGEND_PREVIEW_GAP + 18;
          drawCutPathOverlayLegend(page, fonts, PROOF_PDF_MARGIN + 8, legendBaselineY, {
            finishedCutSizeLabel: cutPathSize
              ? `${cutPathSize.widthMm} × ${cutPathSize.heightMm} mm`
              : null,
          });
        }

        if (customerMessage) {
          drawCustomerMessagePanel(page, fonts, {
            message: customerMessage,
            x: PROOF_PDF_MARGIN,
            y: footerTop + customerMessageHeight,
            width: previewBoxWidth,
          });
        }

        drawApprovalFooterBar(
          page,
          fonts,
          "Please review this proof carefully before approval.",
          "Candid Creative"
        );
      }

      logProofGeneratorStageMarker("artwork-page-complete", {
        pageIndex,
        pageNumber,
        durationMs: Date.now() - startedAt,
        previewMethod: preview.previewMethod,
      });
    }

    preflight.productionFeatures = features;
    preflight.checks = resolvePreflightChecksAfterProductionConfirmation(
      preflight.checks,
      features
    );

    renderSpecificationPages(doc, fonts, logo, preflight);

    logProofGeneratorStageMarker("spec-pages-complete", {
      pageCount: doc.getPageCount(),
      sourcePageCount,
    });

    updateProofPageIndicators(doc.getPages(), fonts, 1);

    input.preflight.productionFeatures = features;
    input.preflight.checks = preflight.checks;

    const bytes = await doc.save();
    const pdfBuffer = Buffer.from(bytes);

    const validation = await validateGeneratedProofPdf(pdfBuffer);
    if (!validation.ok) {
      throw new Error(`Generated proof PDF failed validation: ${validation.reason}`);
    }

    logProofGeneratorStageMarker("multi-page-proof-complete", {
      sourcePageCount,
      pageCount: validation.pageCount,
      pdfBufferByteLength: pdfBuffer.byteLength,
    });

    return pdfBuffer;
  } catch (error) {
    logOriginalGenerationError(error, { stage: "generateMultiPageCustomerProofPdf-catch" });
    const detail = error instanceof Error ? error.message : "Unknown PDF generation error.";
    throw wrapProofGenerationError(
      `Branded proof PDF generation failed: ${detail}`,
      error
    );
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
