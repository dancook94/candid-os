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

export async function loadCandidLogoPng(maxWidth = 128) {
  const logoPath = path.join(process.cwd(), "public", "LOGO_YELLOW.svg");
  const svg = await fs.readFile(logoPath);
  return sharp(svg).png().resize({ width: maxWidth }).toBuffer();
}
