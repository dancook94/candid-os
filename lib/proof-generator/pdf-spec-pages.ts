import type { PDFDocument, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";

import {
  PROOF_PDF_MARGIN,
  PROOF_PDF_PAGE_HEIGHT,
  PROOF_PDF_PAGE_WIDTH,
} from "@/lib/proof-generator/pdf-brand";
import {
  drawApprovalDisclaimer,
  drawApprovalFooterBar,
  drawPreflightSectionCard,
  drawProofPageHeader,
  drawSpecificationSectionCard,
  estimatePreflightSectionCardHeight,
  estimateSpecificationSectionCardHeight,
  type ProofPdfFonts,
} from "@/lib/proof-generator/pdf-layout";
import {
  PDF_NOT_SPECIFIED,
  formatBleedAllowanceLabel,
  formatCustomerSpotColoursLabel,
  formatEffectiveResolutionLabel,
  formatFinishedSizeDetectionLabel,
  formatPdfDimensionsLabel,
  formatPdfDimensionsFromBox,
  formatProductionFeaturesForCustomerProof,
  formatProofFieldValue,
  formatProofQuantity,
  formatProofScaleLabel,
  joinPdfParts,
} from "@/lib/proof-generator/pdf-text";
import type { PreflightResult } from "@/lib/proof-generator/types";

const SECTION_GAP = 12;
const FOOTER_BAR_HEIGHT = 34;
const FOOTER_GAP = 8;
const DISCLAIMER_RESERVE = 96;

type LogoAsset = Awaited<
  ReturnType<typeof import("@/lib/proof-generator/pdf-layout").embedCandidLogo>
>;

function contentWidth() {
  return PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN * 2;
}

function leftColumnWidth() {
  return Math.floor(contentWidth() * 0.52);
}

function rightColumnWidth() {
  return contentWidth() - leftColumnWidth() - 16;
}

function contentFloor(includeDisclaimerReserve: boolean) {
  return (
    PROOF_PDF_MARGIN +
    FOOTER_BAR_HEIGHT +
    FOOTER_GAP +
    (includeDisclaimerReserve ? DISCLAIMER_RESERVE : 12)
  );
}

function availableHeight(currentY: number, includeDisclaimerReserve: boolean) {
  return currentY - contentFloor(includeDisclaimerReserve);
}

function splitChecksToFit(
  checks: PreflightResult["checks"],
  maxHeight: number,
  width: number,
  fonts: ProofPdfFonts
) {
  if (maxHeight <= 40 || checks.length === 0) {
    return { chunk: [] as PreflightResult["checks"], remainder: checks };
  }

  for (let count = checks.length; count >= 1; count -= 1) {
    const chunk = checks.slice(0, count);
    const height = estimatePreflightSectionCardHeight(chunk, width, fonts);
    if (height <= maxHeight) {
      return { chunk, remainder: checks.slice(count) };
    }
  }

  return { chunk: [checks[0]], remainder: checks.slice(1) };
}

function splitRowsToFit(
  rows: Array<{ label: string; value: string }>,
  maxHeight: number,
  width: number,
  fonts: ProofPdfFonts
) {
  if (maxHeight <= 40 || rows.length === 0) {
    return {
      chunk: [] as Array<{ label: string; value: string }>,
      remainder: rows,
    };
  }

  for (let count = rows.length; count >= 1; count -= 1) {
    const chunk = rows.slice(0, count);
    const height = estimateSpecificationSectionCardHeight(chunk, width, fonts);
    if (height <= maxHeight) {
      return { chunk, remainder: rows.slice(count) };
    }
  }

  return { chunk: [rows[0]], remainder: rows.slice(1) };
}

export function updateProofPageIndicators(
  pages: PDFPage[],
  fonts: ProofPdfFonts,
  startPageNumber = 1
) {
  const totalPages = pages.length;

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const pageNumber = startPageNumber + index;
    const rightEdge = PROOF_PDF_PAGE_WIDTH - PROOF_PDF_MARGIN;
    const top = PROOF_PDF_PAGE_HEIGHT - PROOF_PDF_MARGIN;

    page.drawRectangle({
      x: rightEdge - 56,
      y: top - 34,
      width: 56,
      height: 18,
      color: rgb(1, 1, 1),
    });

    const indicator = `${String(pageNumber).padStart(2, "0")} / ${String(totalPages).padStart(2, "0")}`;
    page.drawText(indicator, {
      x: rightEdge - fonts.bold.widthOfTextAtSize(indicator, 9),
      y: top - 28,
      size: 9,
      font: fonts.bold,
      color: rgb(0.984, 0.82, 0.173),
    });
  }
}

export function renderSpecificationPages(
  doc: PDFDocument,
  fonts: ProofPdfFonts,
  logo: LogoAsset,
  preflight: PreflightResult
) {
  const pages: PDFPage[] = [];
  const leftX = PROOF_PDF_MARGIN;
  const leftWidth = leftColumnWidth();
  const rightX = PROOF_PDF_MARGIN + leftWidth + 16;
  const rightWidth = rightColumnWidth();
  const fullWidth = contentWidth();

  const primaryItem = preflight.quotedItems[0] ?? null;
  const pageSize = preflight.metadata.pageSize.value;
  const finishedSize =
    preflight.metadata.finishedSize?.value ??
    preflight.metadata.trimBox.value ??
    pageSize;
  const sizeComparison = preflight.sizeComparison;
  const bleedAllowanceMm = preflight.metadata.bleedAllowanceMm?.value ?? null;

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
    {
      label: "Finished / trim size",
      value: formatPdfDimensionsFromBox(finishedSize),
    },
    {
      label: "Page size",
      value: formatPdfDimensionsFromBox(pageSize),
    },
    {
      label: "Bleed",
      value: formatBleedAllowanceLabel(bleedAllowanceMm),
    },
    {
      label: "Size detection",
      value: formatFinishedSizeDetectionLabel(preflight.metadata),
    },
    { label: "Scale", value: formatProofScaleLabel(sizeComparison?.matchedScaleLabel ?? null) },
    {
      label: "Page count",
      value:
        preflight.metadata.pageCount != null
          ? String(preflight.metadata.pageCount)
          : PDF_NOT_SPECIFIED,
    },
    {
      label: "Colour mode",
      value: formatProofFieldValue(preflight.metadata.colourMode.value ?? null),
    },
    {
      label: "Effective resolution",
      value: formatEffectiveResolutionLabel(sizeComparison),
    },
    { label: "Spot colours", value: formatCustomerSpotColoursLabel(preflight) },
  ];

  const productionSeparations =
    preflight.productionFeatures.spotColourGroups.productionSeparations;
  if (productionSeparations.length > 0) {
    suppliedRows.push({
      label: "Production separations",
      value: productionSeparations.join(", "),
    });
  }

  const preflightChecks = preflight.checks.filter((check) => check.status !== "info");
  const remainingProductionRows = formatProductionFeaturesForCustomerProof(preflight);

  let remainingChecks = preflightChecks;
  let remainingProductionRowsMutable = remainingProductionRows;

  const leftSections = [
    { title: "Quoted specification", rows: quotedRows },
    { title: "Artwork supplied", rows: suppliedRows },
  ];

  function addPage() {
    const page = doc.addPage([PROOF_PDF_PAGE_WIDTH, PROOF_PDF_PAGE_HEIGHT]);
    const header = drawProofPageHeader(page, fonts, logo, pages.length + 2, pages.length + 2, {
      showPageIndicator: false,
    });
    pages.push(page);
    return { page, contentStartY: header.contentStartY };
  }

  let { page, contentStartY } = addPage();
  let leftY = contentStartY;
  let rightY = contentStartY;
  let flowY = contentStartY;
  let isFirstSpecPage = true;
  let preflightStarted = false;
  let productionStarted = false;

  for (const section of leftSections) {
    leftY = drawSpecificationSectionCard(page, fonts, {
      title: section.title,
      x: leftX,
      y: leftY,
      width: leftWidth,
      rows: section.rows,
    });
  }
  flowY = Math.min(leftY, rightY);

  while (remainingChecks.length > 0 || remainingProductionRowsMutable.length > 0) {
    if (remainingChecks.length > 0) {
      const useRightColumn = isFirstSpecPage && !preflightStarted;
      const activeY = useRightColumn ? rightY : flowY - (preflightStarted ? 0 : 0);
      const activeX = useRightColumn ? rightX : PROOF_PDF_MARGIN;
      const activeWidth = useRightColumn ? rightWidth : fullWidth;
      const reserveDisclaimer =
        remainingProductionRowsMutable.length === 0 && remainingChecks.length <= 4;

      const { chunk, remainder } = splitChecksToFit(
        remainingChecks,
        availableHeight(activeY, reserveDisclaimer),
        activeWidth,
        fonts
      );

      if (chunk.length === 0) {
        ({ page, contentStartY } = addPage());
        leftY = contentStartY;
        rightY = contentStartY;
        flowY = contentStartY;
        isFirstSpecPage = false;
        continue;
      }

      const nextY = drawPreflightSectionCard(page, fonts, {
        title: preflightStarted ? "Automated preflight (continued)" : "Automated preflight",
        x: activeX,
        y: activeY,
        width: activeWidth,
        checks: chunk,
      });

      if (useRightColumn) {
        rightY = nextY;
        flowY = Math.min(leftY, rightY);
      } else {
        flowY = nextY;
      }

      remainingChecks = remainder;
      preflightStarted = true;
      isFirstSpecPage = false;
      continue;
    }

    const startY = flowY - SECTION_GAP;
    const { chunk, remainder } = splitRowsToFit(
      remainingProductionRowsMutable,
      availableHeight(startY, true),
      fullWidth,
      fonts
    );

    if (chunk.length === 0) {
      ({ page, contentStartY } = addPage());
      leftY = contentStartY;
      rightY = contentStartY;
      flowY = contentStartY;
      isFirstSpecPage = false;
      continue;
    }

    flowY = drawSpecificationSectionCard(page, fonts, {
      title: productionStarted ? "Production features (continued)" : "Production features",
      x: PROOF_PDF_MARGIN,
      y: startY,
      width: fullWidth,
      rows: chunk,
    });

    remainingProductionRowsMutable = remainder;
    productionStarted = true;
    isFirstSpecPage = false;
  }

  const disclaimer =
    "Please check all wording, spelling, positioning, dimensions and visual content carefully.\n\nApproval confirms that the artwork shown in this proof is authorised to proceed to production.\n\nColours shown on screen may vary from the final printed result.";

  drawApprovalDisclaimer(
    page,
    fonts,
    disclaimer,
    PROOF_PDF_MARGIN,
    contentFloor(true),
    fullWidth
  );

  drawApprovalFooterBar(
    page,
    fonts,
    "Please review this proof carefully before approval.",
    "Candid Creative"
  );

  return pages;
}
