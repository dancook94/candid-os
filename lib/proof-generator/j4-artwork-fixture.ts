import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function mmToPt(mm: number) {
  return (mm / 25.4) * 72;
}

/**
 * J-4-like customer artwork fixture: red trim background, black "Test" label,
 * square page geometry matching Foamex contour proofs.
 */
export async function buildJ4LikeArtworkPdfBuffer() {
  const pageSizePt = mmToPt(523.28);
  const trimPt = mmToPt(500);
  const insetPt = (pageSizePt - trimPt) / 2;
  const document = await PDFDocument.create();
  const page = document.addPage([pageSizePt, pageSizePt]);
  const font = await document.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({
    x: insetPt,
    y: insetPt,
    width: trimPt,
    height: trimPt,
    color: rgb(0.86, 0.08, 0.08),
  });

  const label = "Test";
  const fontSize = 56;
  const textWidth = font.widthOfTextAtSize(label, fontSize);
  page.drawText(label, {
    x: insetPt + (trimPt - textWidth) / 2,
    y: insetPt + trimPt / 2 - fontSize / 3,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });

  return Buffer.from(await document.save());
}
