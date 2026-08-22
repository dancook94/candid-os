import { PDFDocument, StandardFonts } from "pdf-lib";

import { embedArtworkPreview } from "@/lib/proof-generator/artwork-preview";
import { logProofGeneratorDebug } from "@/lib/proof-generator/artwork-buffer";
import {
  PROOF_PDF_MARGIN,
  PROOF_PDF_PAGE_HEIGHT,
  PROOF_PDF_PAGE_WIDTH,
} from "@/lib/proof-generator/pdf-brand";
import {
  drawApprovalDisclaimer,
  drawApprovalFooterBar,
  drawArtworkPreviewFrame,
  drawCustomerMessagePanel,
  drawMetaGrid,
  drawPreflightStatusCard,
  drawProofHeroTitle,
  drawProofPageHeader,
  drawSectionHeading,
  drawSpecificationRow,
  drawSubsectionHeading,
  embedCandidLogo,
  estimateWrappedLineCount,
  formatProofValue,
} from "@/lib/proof-generator/pdf-layout";
import {
  PDF_MISSING_VALUE,
  formatPdfDimensionsFromBox,
  formatPdfDimensionsLabel,
  joinPdfParts,
} from "@/lib/proof-generator/pdf-text";
import type { PreflightResult } from "@/lib/proof-generator/types";

const TOTAL_PAGES = 2;
const FOOTER_BAR_HEIGHT = 34;
const FOOTER_GAP = 10;

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

    const primaryItem = input.preflight.quotedItems[0] ?? null;
    const customerMessage = input.customerMessage?.trim() ?? "";
    const pageSize = input.preflight.metadata.pageSize.value;
    const sizeComparison = input.preflight.sizeComparison;
    const bleedCheck = input.preflight.checks.find((check) => check.key === "bleed_box");

    const page1 = doc.addPage([PROOF_PDF_PAGE_WIDTH, PROOF_PDF_PAGE_HEIGHT]);
    let y = drawProofPageHeader(page1, fonts, logo, 1, TOTAL_PAGES);
    y = drawProofHeroTitle(page1, fonts, y);

    y = drawMetaGrid(page1, fonts, y, [
      { label: "Job", value: input.jobReference },
      { label: "Project", value: input.projectName },
      { label: "Proof", value: `Version ${input.versionNumber}` },
      {
        label: "Related item",
        value: primaryItem
          ? joinPdfParts([primaryItem.itemReference ?? PDF_MISSING_VALUE, primaryItem.itemName])
          : PDF_MISSING_VALUE,
      },
    ]);

    const footerTop = PROOF_PDF_MARGIN + FOOTER_BAR_HEIGHT + FOOTER_GAP;
    const customerMessageLines = customerMessage
      ? estimateWrappedLineCount(customerMessage, contentWidth() - 24, regular, 10)
      : 0;
    const customerMessageHeight = customerMessage
      ? 34 + customerMessageLines * 12 + 10
      : 0;
    const previewBoxBottom = footerTop + customerMessageHeight + 8;
    const previewBoxHeight = Math.max(240, y - 12 - previewBoxBottom);
    const previewBoxWidth = contentWidth();

    const preview = await embedArtworkPreview(doc, input.sourceBuffer, input.sourceFileName);

    logProofGeneratorDebug("artwork_preview_embedded", {
      sourceFileName: input.sourceFileName,
      previewMethod: preview.previewMethod,
      previewKind: preview.kind,
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
      "Please review this proof carefully before approval."
    );

    const leftX = PROOF_PDF_MARGIN;
    const leftWidth = leftColumnWidth();
    const rightX = PROOF_PDF_MARGIN + leftWidth + 16;
    const rightWidth = rightColumnWidth();

    const page2 = doc.addPage([PROOF_PDF_PAGE_WIDTH, PROOF_PDF_PAGE_HEIGHT]);
    const contentStartY = drawProofPageHeader(page2, fonts, logo, 2, TOTAL_PAGES);

    let leftY = contentStartY;
    leftY = drawSectionHeading(page2, fonts, "PRODUCTION SPECIFICATION", leftX, leftY);
    leftY = drawSubsectionHeading(page2, fonts, "Quoted", leftX, leftY);

    const quotedRows = [
      [
        "Finished size",
        primaryItem?.quotedWidthMm != null && primaryItem?.quotedHeightMm != null
          ? formatPdfDimensionsLabel(primaryItem.quotedWidthMm, primaryItem.quotedHeightMm)
          : PDF_MISSING_VALUE,
      ],
      ["Quantity", primaryItem?.quantity != null ? String(primaryItem.quantity) : PDF_MISSING_VALUE],
      ["Material", formatProofValue(primaryItem?.material ?? null)],
      ["Print specification", formatProofValue(primaryItem?.printSpecification ?? null)],
      ["Sides / finishing", joinPdfParts([primaryItem?.sides, primaryItem?.finishing])],
    ] as const;

    for (const [label, value] of quotedRows) {
      leftY = drawSpecificationRow(page2, fonts, {
        label,
        value,
        x: leftX,
        y: leftY,
        width: leftWidth,
      });
    }

    leftY -= 6;
    leftY = drawSubsectionHeading(page2, fonts, "Artwork supplied", leftX, leftY);

    const suppliedRows = [
      ["Detected size", formatPdfDimensionsFromBox(pageSize)],
      ["Scale", formatProofValue(sizeComparison?.matchedScaleLabel ?? null)],
      [
        "Page count",
        input.preflight.metadata.pageCount != null
          ? String(input.preflight.metadata.pageCount)
          : PDF_MISSING_VALUE,
      ],
      ["Colour mode", formatProofValue(input.preflight.metadata.colourMode.value ?? "Unknown")],
      [
        "Effective resolution",
        sizeComparison?.effectiveResolutionDpi != null
          ? `${sizeComparison.effectiveResolutionDpi} DPI`
          : PDF_MISSING_VALUE,
      ],
      ["Bleed metadata", formatProofValue(bleedCheck?.message ?? null)],
      [
        "Spot colours",
        formatProofValue(input.preflight.metadata.spotColourNames.value.join(", ") || null),
      ],
    ] as const;

    for (const [label, value] of suppliedRows) {
      leftY = drawSpecificationRow(page2, fonts, {
        label,
        value,
        x: leftX,
        y: leftY,
        width: leftWidth,
      });
    }

    let rightY = contentStartY;
    rightY = drawSectionHeading(page2, fonts, "AUTOMATED PREFLIGHT", rightX, rightY);

    const preflightChecks = input.preflight.checks.filter((check) => check.status !== "info");
    for (const check of preflightChecks.slice(0, 7)) {
      rightY = drawPreflightStatusCard(page2, fonts, check, rightX, rightY, rightWidth);
    }

    const disclaimer =
      "Please check all wording, spelling, positioning, dimensions and visual content carefully.\n\nApproval confirms that the artwork shown in this proof is authorised to proceed to production.\n\nColours shown on screen may vary from the final printed result.";

    drawApprovalDisclaimer(
      page2,
      fonts,
      disclaimer,
      PROOF_PDF_MARGIN,
      PROOF_PDF_MARGIN + 72,
      contentWidth()
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
  itemReference?: string | null
) {
  if (itemReference?.trim()) {
    const safeItem = itemReference.trim().replace(/[^\w.-]+/g, "-");
    return `${safeItem}-Proof-v${versionNumber}.pdf`;
  }

  const safeReference = proofReference.trim().replace(/[^\w .-]+/g, "");
  return `${safeReference}.pdf`;
}
