import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

/** Candid yellow (#fbd12c). */
export const CANDID_YELLOW_HEX = "#fbd12c";

/** Near-black body text (#1e1e1c). */
export const CANDID_INK_HEX = "#1e1e1c";

export const PROOF_PDF_PAGE_WIDTH = 595.28;
export const PROOF_PDF_PAGE_HEIGHT = 841.89;
export const PROOF_PDF_MARGIN = 42;

/** Logo width drawn in PDF points (slightly smaller than original 128pt). */
export const PROOF_PDF_LOGO_DISPLAY_WIDTH = 96;

/** Rasterise SVG at this multiple of display width for crisp zoom/print. */
export const PROOF_PDF_LOGO_RASTER_SCALE = 4;

export const PROOF_PDF_LOGO_PATH = path.join(process.cwd(), "public", "LOGO_YELLOW.svg");

let cachedLogoPng: Buffer | null = null;
let cachedLogoRasterWidth = 0;

/**
 * Rasterise the canonical Candid SVG logo to a high-resolution transparent PNG for pdf-lib.
 * Cached in memory so repeated proof generations do not re-degrade the asset.
 */
export async function loadCandidLogoPng(rasterWidth: number) {
  if (cachedLogoPng && cachedLogoRasterWidth === rasterWidth) {
    return cachedLogoPng;
  }

  const svg = await fs.readFile(PROOF_PDF_LOGO_PATH);
  cachedLogoPng = await sharp(svg, { density: 300 })
    .png()
    .resize({ width: rasterWidth })
    .toBuffer();
  cachedLogoRasterWidth = rasterWidth;

  return cachedLogoPng;
}
