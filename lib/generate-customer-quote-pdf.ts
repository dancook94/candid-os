import fs from "node:fs/promises";
import path from "node:path";

import PDFDocument from "pdfkit";
import sharp from "sharp";

import type {
  CustomerFormalQuoteData,
  CustomerFormalQuotePdfInput,
} from "@/lib/customer-formal-quote-data";
import { CUSTOMER_QUOTE_TERMS_SECTIONS } from "@/lib/customer-quote-terms-content";
import {
  formatQuoteProjectName,
  getFormalQuoteStatusLabel,
} from "@/lib/customer-quote-request";

const CANDID_YELLOW = "#fbd12c";
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 45;
const FOOTER_TEXT_Y = PAGE_HEIGHT - PAGE_MARGIN - 40;
const FOOTER_LINE_Y = FOOTER_TEXT_Y - 8;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const CONTENT_BOTTOM = FOOTER_LINE_Y - 10;

type Cursor = { y: number };

function formatGbp(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function loadLogoBuffer() {
  const logoPath = path.join(process.cwd(), "public", "LOGO_YELLOW.svg");
  const svg = await fs.readFile(logoPath);
  return sharp(svg).png().resize({ width: 300 }).toBuffer();
}

async function loadImageBuffer(url: string) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const input = Buffer.from(await response.arrayBuffer());
    return sharp(input)
      .rotate()
      .resize({ width: 220, height: 220, fit: "inside" })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

function addPage(doc: PDFKit.PDFDocument, cursor: Cursor) {
  doc.addPage();
  cursor.y = PAGE_MARGIN;
}

function ensureSpace(
  doc: PDFKit.PDFDocument,
  requiredHeight: number,
  cursor: Cursor
) {
  if (cursor.y + requiredHeight > CONTENT_BOTTOM) {
    addPage(doc, cursor);
  }
}

function textHeight(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  fontSize: number,
  font: "Helvetica" | "Helvetica-Bold" = "Helvetica",
  lineGap = 2
) {
  doc.font(font).fontSize(fontSize);
  return doc.heightOfString(text, { width, lineGap });
}

function drawFooters(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  const totalPages = range.count;

  for (let index = range.start; index < range.start + totalPages; index += 1) {
    doc.switchToPage(index);
    const pageNumber = index - range.start + 1;

    doc
      .save()
      .moveTo(PAGE_MARGIN, FOOTER_LINE_Y)
      .lineTo(PAGE_WIDTH - PAGE_MARGIN, FOOTER_LINE_Y)
      .lineWidth(0.5)
      .strokeColor("#e5e5e5")
      .stroke()
      .restore();

    doc.font("Helvetica").fontSize(8).fillColor("#737373");

    doc.text("Candid Creative Limited", PAGE_MARGIN, FOOTER_TEXT_Y, {
      lineBreak: false,
    });

    const website = "www.candidcreative.uk";
    const websiteWidth = doc.widthOfString(website);
    doc.text(website, PAGE_WIDTH / 2 - websiteWidth / 2, FOOTER_TEXT_Y, {
      lineBreak: false,
    });

    const pageLabel = `Page ${pageNumber} of ${totalPages}`;
    const pageLabelWidth = doc.widthOfString(pageLabel);
    doc.text(pageLabel, PAGE_WIDTH - PAGE_MARGIN - pageLabelWidth, FOOTER_TEXT_Y, {
      lineBreak: false,
    });
  }
}

function drawSectionHeading(
  doc: PDFKit.PDFDocument,
  title: string,
  cursor: Cursor
) {
  ensureSpace(doc, 28, cursor);
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor("#1e1e1c")
    .text(title, PAGE_MARGIN, cursor.y, { width: CONTENT_WIDTH });
  cursor.y = doc.y + 10;
}

function drawBodyText(
  doc: PDFKit.PDFDocument,
  text: string,
  cursor: Cursor,
  options?: { fontSize?: number; width?: number }
) {
  const fontSize = options?.fontSize ?? 9.5;
  const width = options?.width ?? CONTENT_WIDTH;
  const blockHeight = textHeight(doc, text, width, fontSize) + 6;

  ensureSpace(doc, blockHeight, cursor);
  doc
    .font("Helvetica")
    .fontSize(fontSize)
    .fillColor("#525252")
    .text(text, PAGE_MARGIN, cursor.y, { width, lineGap: 2 });
  cursor.y = doc.y + 6;
}

function measureSummaryCard(
  doc: PDFKit.PDFDocument,
  lines: string[],
  width: number
) {
  let height = 30;

  for (const line of lines) {
    if (!line) {
      height += 3;
      continue;
    }

    height += textHeight(doc, line, width - 20, 9) + 2;
  }

  return height + 8;
}

function drawSummaryCard(
  doc: PDFKit.PDFDocument,
  title: string,
  lines: string[],
  x: number,
  y: number,
  width: number,
  height: number
) {
  doc
    .roundedRect(x, y, width, height, 8)
    .lineWidth(1)
    .strokeColor("#e5e5e5")
    .stroke();

  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor("#737373")
    .text(title.toUpperCase(), x + 10, y + 10, {
      width: width - 20,
      characterSpacing: 0.6,
    });

  let lineY = y + 24;
  for (const line of lines) {
    if (!line) {
      lineY += 3;
      continue;
    }

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#404040")
      .text(line, x + 10, lineY, {
        width: width - 20,
        lineGap: 1,
      });
    lineY = doc.y + 2;
  }
}

function estimateLineItemHeight(
  doc: PDFKit.PDFDocument,
  item: CustomerFormalQuoteData["lineItems"][number],
  hasImage: boolean
) {
  const padding = 10;
  const imageSize = 64;
  const textXOffset = hasImage ? imageSize + 12 : 0;
  const textWidth = CONTENT_WIDTH - padding * 2 - textXOffset;
  const metricsHeight = 18;

  let blockHeight = padding;
  blockHeight += textHeight(doc, item.title, textWidth, 11, "Helvetica-Bold") + 2;

  if (item.isOptional) {
    blockHeight += 10;
  }

  if (item.description) {
    blockHeight +=
      textHeight(doc, item.description, textWidth, 9.5, "Helvetica", 1) + 4;
  }

  if (hasImage) {
    blockHeight = Math.max(blockHeight, imageSize);
  }

  blockHeight += metricsHeight + padding;
  return blockHeight + 8;
}

function drawLineItem(
  doc: PDFKit.PDFDocument,
  item: CustomerFormalQuoteData["lineItems"][number],
  imageBuffer: Buffer | null,
  cursor: Cursor
) {
  const padding = 10;
  const imageSize = 64;
  const cardLeft = PAGE_MARGIN;
  const cardWidth = CONTENT_WIDTH;
  const hasImage = Boolean(imageBuffer);
  const textX = cardLeft + padding + (hasImage ? imageSize + 12 : 0);
  const textWidth = cardWidth - padding * 2 - (hasImage ? imageSize + 12 : 0);
  const cardTop = cursor.y;
  let contentY = cardTop + padding;

  if (hasImage && imageBuffer) {
    doc
      .roundedRect(cardLeft + padding, contentY, imageSize, imageSize, 6)
      .fillColor("#fafafa")
      .fill();
    doc.image(imageBuffer, cardLeft + padding + 2, contentY + 2, {
      fit: [imageSize - 4, imageSize - 4],
      align: "center",
      valign: "center",
    });
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#1e1e1c")
    .text(item.title, textX, contentY, { width: textWidth, lineGap: 1 });

  if (item.isOptional) {
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#525252")
      .text("Optional", textX, doc.y + 2, { width: textWidth, lineBreak: false });
  }

  if (item.description) {
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor("#525252")
      .text(item.description, textX, doc.y + 4, {
        width: textWidth,
        lineGap: 1,
      });
  }

  const textBottom = doc.y;
  const imageBottom = hasImage ? cardTop + padding + imageSize : cardTop + padding;
  const metricsY = Math.max(textBottom + 8, imageBottom + 4);

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#525252")
    .text(
      `Qty ${item.quantity}   Unit ${formatGbp(item.unitPrice)}   Total ${formatGbp(item.lineTotal)}`,
      cardLeft + padding,
      metricsY,
      { width: cardWidth - padding * 2, lineBreak: false }
    );

  const cardBottom = metricsY + 16;
  doc
    .roundedRect(cardLeft, cardTop, cardWidth, cardBottom - cardTop, 8)
    .lineWidth(1)
    .strokeColor("#e5e5e5")
    .stroke();

  cursor.y = cardBottom + 8;
}

function drawTotalsBlock(
  doc: PDFKit.PDFDocument,
  quote: CustomerFormalQuoteData,
  cursor: Cursor
) {
  const blockHeight = 92;
  ensureSpace(doc, blockHeight, cursor);

  const totalsWidth = 210;
  const totalsX = PAGE_WIDTH - PAGE_MARGIN - totalsWidth;
  const totalsTop = cursor.y;

  doc
    .roundedRect(totalsX, totalsTop, totalsWidth, blockHeight, 8)
    .lineWidth(1)
    .strokeColor("#e5e5e5")
    .stroke();

  const row = (label: string, value: string, y: number) => {
    const valueWidth = doc.widthOfString(value);
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor("#737373")
      .text(label, totalsX + 12, y, { lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .fillColor("#1e1e1c")
      .text(value, totalsX + totalsWidth - 12 - valueWidth, y, { lineBreak: false });
  };

  row("Subtotal", formatGbp(quote.subtotal), totalsTop + 12);
  row("VAT (20%)", formatGbp(quote.vatAmount), totalsTop + 30);

  doc
    .rect(totalsX, totalsTop + 50, totalsWidth, 42)
    .fillColor(CANDID_YELLOW)
    .fillOpacity(0.18)
    .fill();
  doc.fillOpacity(1);

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#404040")
    .text("Total", totalsX + 12, totalsTop + 62, {
      width: totalsWidth - 24,
      lineBreak: false,
    });
  doc
    .font("Helvetica-Bold")
    .fontSize(15)
    .fillColor("#1e1e1c")
    .text(
      formatGbp(quote.total),
      totalsX + totalsWidth - 12 - doc.widthOfString(formatGbp(quote.total)),
      totalsTop + 58,
      { lineBreak: false }
    );

  cursor.y = totalsTop + blockHeight + 10;
}

export async function generateCustomerQuotePdf(quote: CustomerFormalQuotePdfInput) {
  const logoBuffer = await loadLogoBuffer();
  const imageBuffers = await Promise.all(
    quote.lineItems.map((item) =>
      item.imageUrl ? loadImageBuffer(item.imageUrl) : Promise.resolve(null)
    )
  );

  const doc = new PDFDocument({
    size: "A4",
    margins: {
      top: PAGE_MARGIN,
      bottom: PAGE_HEIGHT - FOOTER_TEXT_Y + 8,
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
    },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: `Quotation Q-${quote.quoteNumber}`,
      Author: "Candid Creative Limited",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk as Buffer));

  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const cursor: Cursor = { y: PAGE_MARGIN };
  const displayProjectName = formatQuoteProjectName(quote.projectName);
  const statusLabel = getFormalQuoteStatusLabel(quote.quoteStatus);

  doc.image(logoBuffer, PAGE_MARGIN, cursor.y, { width: 120 });
  cursor.y += 58;

  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor("#1e1e1c")
    .text("Quotation", PAGE_MARGIN, cursor.y, { width: CONTENT_WIDTH, lineBreak: false });
  cursor.y = doc.y + 8;

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#1e1e1c")
    .text(displayProjectName, PAGE_MARGIN, cursor.y, {
      width: CONTENT_WIDTH,
      lineGap: 1,
    });
  cursor.y = doc.y + 8;

  if (quote.customerCompanyName) {
    doc
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor("#737373")
      .text(`Prepared for ${quote.customerCompanyName}`, PAGE_MARGIN, cursor.y, {
        width: CONTENT_WIDTH,
        lineBreak: false,
      });
    cursor.y = doc.y + 10;
  }

  const badgeY = cursor.y;
  let badgeX = PAGE_MARGIN;
  const badgeGap = 8;

  const drawMetaBadge = (label: string, value: string, width = 108) => {
    doc
      .roundedRect(badgeX, badgeY, width, 34, 6)
      .lineWidth(1)
      .strokeColor("#e5e5e5")
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#737373")
      .text(label.toUpperCase(), badgeX + 10, badgeY + 8, {
        width: width - 20,
        lineBreak: false,
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#1e1e1c")
      .text(value, badgeX + 10, badgeY + 18, {
        width: width - 20,
        lineBreak: false,
      });
    badgeX += width + badgeGap;
  };

  drawMetaBadge("Version", String(quote.versionNumber));
  drawMetaBadge("Status", statusLabel, 118);
  if (quote.expiryDate) {
    drawMetaBadge("Expiry", formatDate(quote.expiryDate), 132);
  }

  cursor.y = badgeY + 44;

  if (quote.introduction) {
    drawBodyText(doc, quote.introduction, cursor, { fontSize: 10 });
  }

  const cardGap = 8;
  const cardWidth = (CONTENT_WIDTH - cardGap * 2) / 3;
  const fromLines = [
    "Candid Creative Limited",
    "Innovation House",
    "Cray Road, Sidcup",
    "DA14 5DP",
    "www.candidcreative.uk",
    "020 3149 8995",
    "Company no. 15150018",
    "VAT no. 451 8762 73",
  ];
  const preparedForLines = [
    quote.customerCompanyName,
    quote.customerContactName,
    quote.customerEmail,
  ].filter(Boolean) as string[];
  const quoteDetailLines = [`Quote number`, `Q-${quote.quoteNumber}`];

  if (quote.dateSent) {
    quoteDetailLines.push("", "Date sent", formatDate(quote.dateSent));
  }

  if (quote.paymentTermsDays !== null) {
    quoteDetailLines.push("", "Payment terms", `${quote.paymentTermsDays} days`);
  }

  if (quote.expiryDate) {
    quoteDetailLines.push("", "Valid until", formatDate(quote.expiryDate));
  }

  if (quote.approvedDeadline) {
    quoteDetailLines.push("", "Approved deadline", quote.approvedDeadline);
  }

  const cardHeight = Math.max(
    measureSummaryCard(doc, fromLines, cardWidth),
    measureSummaryCard(
      doc,
      preparedForLines.length > 0 ? preparedForLines : ["—"],
      cardWidth
    ),
    measureSummaryCard(doc, quoteDetailLines, cardWidth)
  );

  ensureSpace(doc, cardHeight + 12, cursor);
  const cardsTop = cursor.y;

  drawSummaryCard(doc, "From", fromLines, PAGE_MARGIN, cardsTop, cardWidth, cardHeight);
  drawSummaryCard(
    doc,
    "Prepared for",
    preparedForLines.length > 0 ? preparedForLines : ["—"],
    PAGE_MARGIN + cardWidth + cardGap,
    cardsTop,
    cardWidth,
    cardHeight
  );
  drawSummaryCard(
    doc,
    "Quote details",
    quoteDetailLines,
    PAGE_MARGIN + (cardWidth + cardGap) * 2,
    cardsTop,
    cardWidth,
    cardHeight
  );

  cursor.y = cardsTop + cardHeight + 16;

  if (quote.lineItems.length > 0) {
    const firstItemHeight = estimateLineItemHeight(
      doc,
      quote.lineItems[0],
      Boolean(imageBuffers[0])
    );
    const productsHeadingHeight = 24;

    if (cursor.y + productsHeadingHeight + firstItemHeight > CONTENT_BOTTOM) {
      addPage(doc, cursor);
    }

    drawSectionHeading(doc, "Products", cursor);

    for (const [index, item] of quote.lineItems.entries()) {
      const itemHeight = estimateLineItemHeight(
        doc,
        item,
        Boolean(imageBuffers[index])
      );
      ensureSpace(doc, itemHeight, cursor);
      drawLineItem(doc, item, imageBuffers[index], cursor);
    }
  }

  const totalsAndNotesHeight =
    92 + (quote.customerNotes ? 40 + textHeight(doc, quote.customerNotes, CONTENT_WIDTH, 9.5) : 0);
  ensureSpace(doc, totalsAndNotesHeight, cursor);
  drawTotalsBlock(doc, quote, cursor);

  if (quote.customerNotes) {
    drawSectionHeading(doc, "Notes", cursor);
    drawBodyText(doc, quote.customerNotes, cursor, { fontSize: 9.5 });
  }

  addPage(doc, cursor);
  drawSectionHeading(doc, "Terms & Conditions", cursor);

  for (const section of CUSTOMER_QUOTE_TERMS_SECTIONS) {
    const firstParagraph = section.paragraphs?.[0] ?? section.subsections?.[0]?.paragraphs[0];
    const headingBlockHeight =
      18 +
      (firstParagraph
        ? textHeight(doc, firstParagraph, CONTENT_WIDTH, 9.5) + 8
        : 0);

    ensureSpace(doc, headingBlockHeight, cursor);

    doc
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .fillColor("#1e1e1c")
      .text(section.title, PAGE_MARGIN, cursor.y, { width: CONTENT_WIDTH });
    cursor.y = doc.y + 6;

    for (const paragraph of section.paragraphs ?? []) {
      drawBodyText(doc, paragraph, cursor, { fontSize: 9.5 });
    }

    for (const subsection of section.subsections ?? []) {
      const firstSubParagraph = subsection.paragraphs[0];
      const subsectionBlockHeight =
        16 +
        (firstSubParagraph
          ? textHeight(doc, firstSubParagraph, CONTENT_WIDTH, 9.5) + 6
          : 0);

      ensureSpace(doc, subsectionBlockHeight, cursor);

      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor("#262626")
        .text(subsection.title, PAGE_MARGIN, cursor.y, { width: CONTENT_WIDTH });
      cursor.y = doc.y + 4;

      for (const paragraph of subsection.paragraphs) {
        drawBodyText(doc, paragraph, cursor, { fontSize: 9.5 });
      }
    }

    cursor.y += 4;
  }

  drawFooters(doc);
  doc.end();

  return finished;
}
