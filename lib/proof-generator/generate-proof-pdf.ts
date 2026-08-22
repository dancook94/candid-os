import { PDFDocument, StandardFonts } from "pdf-lib";

import { embedArtworkPreview } from "@/lib/proof-generator/artwork-preview";
import { logProofGeneratorDebug } from "@/lib/proof-generator/artwork-buffer";
import {
  PROOF_PDF_MARGIN,
  PROOF_PDF_PAGE_HEIGHT,
  PROOF_PDF_PAGE_WIDTH,
} from "@/lib/proof-generator/pdf-brand";
import { buildCustomerProofPdfFileName } from "@/lib/proofs/dropbox";
import {
  drawApprovalDisclaimer,
  drawApprovalFooterBar,
  drawArtworkPreviewFrame,
  drawCustomerMessagePanel,
  drawMetaGrid,
  drawPreflightSectionCard,
  drawProofHeroTitle,
  drawProofPageHeader,
  drawProofVersionSubtitle,
  drawSpecificationSectionCard,
  embedCandidLogo,
  estimateWrappedLineCount,
} from "@/lib/proof-generator/pdf-layout";
import {
  PDF_NOT_SPECIFIED,
  formatBleedMetadataLabel,
  formatEffectiveResolutionLabel,
  formatPdfDimensionsLabel,
  formatPdfDimensionsFromBox,
  formatProofFieldValue,
  formatProofQuantity,
  formatProofScaleLabel,
  formatSpotColoursLabel,
  joinPdfParts,
} from "@/lib/proof-generator/pdf-text";
import type { PreflightResult } from "@/lib/proof-generator/types";

const TOTAL_PAGES = 2;
const FOOTER_BAR_HEIGHT = 34;
const FOOTER_GAP = 8;

function contentWidth() {
  return PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN * 2;
}

function leftColumnWidth() {
  return Math.floor(contentWidth() * 0.52);
}

function rightColumnWidth() {
  return contentWidth() - leftColumnWidth() - 16;
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
    const pageSize = input.preflight.metadata.pageSize.value;
    const sizeComparison = input.preflight.sizeComparison;
    const bleedCheck = input.preflight.checks.find((check) => check.key === "bleed_box");

    const page1 = doc.addPage([PROOF_PDF_PAGE_WIDTH, PROOF_PDF_PAGE_HEIGHT]);
    const page1Header = drawProofPageHeader(page1, fonts, logo, 1, TOTAL_PAGES);
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

    const preview = await embedArtworkPreview(doc, input.sourceBuffer, input.sourceFileName);

    logProofGeneratorDebug("artwork_preview_embedded", {
      sourceFileName: input.sourceFileName,
      previewMethod: preview.previewMethod,
      previewKind: preview.kind,
      previewPixelWidth:
        preview.kind === "image" ? preview.image.width : Math.round(preview.width),
      previewPixelHeight:
        preview.kind === "image" ? preview.image.height : Math.round(preview.height),
    });

    drawArtworkPreviewFrame(page1, {
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

    const leftX = PROOF_PDF_MARGIN;
    const leftWidth = leftColumnWidth();
    const rightX = PROOF_PDF_MARGIN + leftWidth + 16;
    const rightWidth = rightColumnWidth();

    const page2 = doc.addPage([PROOF_PDF_PAGE_WIDTH, PROOF_PDF_PAGE_HEIGHT]);
    const page2Header = drawProofPageHeader(page2, fonts, logo, 2, TOTAL_PAGES);
    const contentStartY = page2Header.contentStartY;

    const quotedRows = [
      {
        label: "Finished size",
        value:
          primaryItem?.quotedWidthMm != null && primaryItem?.quotedHeightMm != null
            ? formatPdfDimensionsLabel(primaryItem.quotedWidthMm, primaryItem.quotedHeightMm)
            : PDF_NOT_SPECIFIED,
      },
      { label: "Quantity", value: formatProofQuantity(primaryItem?.quantity ?? null) },
      { label: "Material", value: formatProofFieldValue(primaryItem?.material ?? null) },
      {
        label: "Print specification",
        value: formatProofFieldValue(primaryItem?.printSpecification ?? null),
      },
      {
        label: "Sides / finishing",
        value: joinPdfParts([primaryItem?.sides, primaryItem?.finishing]),
      },
    ];

    const suppliedRows = [
      { label: "Detected size", value: formatPdfDimensionsFromBox(pageSize) },
      { label: "Scale", value: formatProofScaleLabel(sizeComparison?.matchedScaleLabel ?? null) },
      {
        label: "Page count",
        value:
          input.preflight.metadata.pageCount != null
            ? String(input.preflight.metadata.pageCount)
            : PDF_NOT_SPECIFIED,
      },
      {
        label: "Colour mode",
        value: formatProofFieldValue(input.preflight.metadata.colourMode.value ?? null),
      },
      {
        label: "Effective resolution",
        value: formatEffectiveResolutionLabel(sizeComparison),
      },
      { label: "Bleed metadata", value: formatBleedMetadataLabel(bleedCheck) },
      { label: "Spot colours", value: formatSpotColoursLabel(input.preflight.metadata) },
    ];

    let leftY = contentStartY;
    leftY = drawSpecificationSectionCard(page2, fonts, {
      title: "Quoted specification",
      x: leftX,
      y: leftY,
      width: leftWidth,
      rows: quotedRows,
    });

    drawSpecificationSectionCard(page2, fonts, {
      title: "Artwork supplied",
      x: leftX,
      y: leftY,
      width: leftWidth,
      rows: suppliedRows,
    });

    const preflightChecks = input.preflight.checks.filter((check) => check.status !== "info");

    drawPreflightSectionCard(page2, fonts, {
      title: "Automated preflight",
      x: rightX,
      y: contentStartY,
      width: rightWidth,
      checks: preflightChecks.slice(0, 7),
    });

    const disclaimer =
      "Please check all wording, spelling, positioning, dimensions and visual content carefully.\n\nApproval confirms that the artwork shown in this proof is authorised to proceed to production.\n\nColours shown on screen may vary from the final printed result.";

    drawApprovalDisclaimer(
      page2,
      fonts,
      disclaimer,
      PROOF_PDF_MARGIN,
      PROOF_PDF_MARGIN + FOOTER_BAR_HEIGHT + 88,
      contentWidth()
    );

    drawApprovalFooterBar(
      page2,
      fonts,
      "Please review this proof carefully before approval.",
      "Candid Creative"
    );

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
