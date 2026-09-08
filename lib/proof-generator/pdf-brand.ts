import { readFile } from "node:fs/promises";
import path from "node:path";

/** Candid yellow (#fbd12c). */
export const CANDID_YELLOW_HEX = "#fbd12c";

/** Near-black body text (#1e1e1c). */
export const CANDID_INK_HEX = "#1e1e1c";

export const PROOF_PDF_PAGE_WIDTH = 595.28;
export const PROOF_PDF_PAGE_HEIGHT = 841.89;
export const PROOF_PDF_MARGIN = 42;

/** Logo width drawn in PDF points (slightly smaller than original 128pt). */
export const PROOF_PDF_LOGO_DISPLAY_WIDTH = 96;

/** Rasterise logo at this multiple of display width for crisp zoom/print. */
export const PROOF_PDF_LOGO_RASTER_SCALE = 4;

export const PROOF_PDF_LOGO_PATH = path.join(process.cwd(), "public", "LOGO_YELLOW.png");

let cachedLogoPng: Buffer | null = null;

/**
 * Load the canonical Candid PNG logo bytes for pdf-lib embedding.
 * Cached in memory so repeated proof generations do not re-read the asset.
 */
export async function loadCandidLogoPng() {
  if (cachedLogoPng) {
    return cachedLogoPng;
  }

  cachedLogoPng = await readFile(PROOF_PDF_LOGO_PATH);
  return cachedLogoPng;
}
