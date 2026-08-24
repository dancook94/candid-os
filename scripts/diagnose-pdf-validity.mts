/**
 * Temporary diagnostic — validate source vs suppressed vs branded proof PDFs.
 * Usage: node --import tsx scripts/diagnose-pdf-validity.mts
 */
import fs from "node:fs";

import { PDFDocument } from "pdf-lib";

import { buildContourCutTestPdfBuffer } from "@/lib/proof-generator/cut-path-test-pdfs";
import { generateCustomerProofPdf } from "@/lib/proof-generator/generate-proof-pdf";
import { createCustomerPreviewPdfBuffer } from "@/lib/proof-generator/suppress-cut-path-preview";
import type { PreflightResult } from "@/lib/proof-generator/types";

async function tryLoad(label: string, buffer: Buffer) {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = doc.getPageCount();
    const reloaded = await PDFDocument.load(await doc.save());
    console.log(`[${label}] pdf-lib load+save round-trip OK (${pages} page(s))`);
    return true;
  } catch (error) {
    console.log(
      `[${label}] pdf-lib FAIL:`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

function buildTestPreflight(): PreflightResult {
  return {
    analysisVersion: "2.0.0",
    overallStatus: "pass",
    checks: [],
    metadata: {
      fileName: "artwork.pdf",
      fileSizeBytes: 1000,
      mimeType: "application/pdf",
      inputType: "pdf",
      pageCount: 1,
      pdfVersion: { value: "1.4", confidence: "high", source: "test" },
      pageSize: {
        value: { widthPt: 1488, heightPt: 1488, widthMm: 523.28, heightMm: 523.28 },
        confidence: "high",
        source: "test",
      },
      orientation: { value: "square", confidence: "high", source: "test" },
      mediaBox: { value: null, confidence: "low", source: "n/a" },
      cropBox: { value: null, confidence: "low", source: "n/a" },
      trimBox: {
        value: { widthPt: 1417, heightPt: 1417, widthMm: 500, heightMm: 500 },
        confidence: "high",
        source: "test",
      },
      bleedBox: { value: null, confidence: "low", source: "n/a" },
      artBox: { value: null, confidence: "low", source: "n/a" },
      finishedSize: {
        value: { widthPt: 1134, heightPt: 1134, widthMm: 400, heightMm: 400 },
        confidence: "high",
        source: "cut_path",
      },
      finishedSizeSource: { value: "cut_path", confidence: "high", source: "test" },
      bleedAllowanceMm: { value: null, confidence: "low", source: "n/a" },
      colourMode: { value: "CMYK", confidence: "high", source: "test" },
      cmykPresent: { value: true, confidence: "high", source: "test" },
      rgbPresent: { value: false, confidence: "high", source: "test" },
      grayscalePresent: { value: false, confidence: "high", source: "test" },
      spotColourNames: { value: ["CutContour"], confidence: "high", source: "test" },
      fonts: { value: [], confidence: "high", source: "n/a" },
      rasterImages: { value: [], confidence: "high", source: "test" },
      imageWidthPx: { value: null, confidence: "low", source: "n/a" },
      imageHeightPx: { value: null, confidence: "low", source: "n/a" },
    },
    sizeComparison: null,
    quotedItems: [],
    productionFeatures: {
      cutPathCandidates: [],
      whiteInkCandidates: [],
      layers: [],
      spotColourGroups: { productionSeparations: ["CutContour"], otherSpotColours: [] },
      expectsCutPath: true,
      cutPathOverlayAvailable: true,
      confirmedCutPath: {
        name: "CutContour",
        sourceType: "separation",
        confirmedAt: "2026-01-01T00:00:00.000Z",
        confirmedByProfileId: "user-1",
      },
      showCutPathOnProof: true,
      cutPathSize: { widthMm: 400, heightMm: 400, widthPt: 0, heightPt: 0 },
      resolvedProductionFinishedSize: {
        widthMm: 400,
        heightMm: 400,
        widthPt: 0,
        heightPt: 0,
      },
    },
    fonts: { status: "all_outlined", names: [], confidence: "high", message: "" },
    images: { count: 0, linkStatus: "unknown", missingLinks: [], confidence: "low", message: "" },
  };
}

async function embedIsolationTest(label: string, artworkBuffer: Buffer) {
  const host = await PDFDocument.create();
  try {
    const [page] = await host.embedPdf(artworkBuffer, [0]);
    const outPage = host.addPage([595, 842]);
    outPage.drawPage(page, { x: 50, y: 100, width: 400, height: 400 });
    const bytes = await host.save();
    await tryLoad(`${label} (embedded in fresh doc)`, Buffer.from(bytes));
  } catch (error) {
    console.log(
      `[${label} embed] FAIL:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function main() {
  const source = buildContourCutTestPdfBuffer({ shape: "circle" });
  const suppressed = await createCustomerPreviewPdfBuffer(source, {
    name: "CutContour",
    sourceType: "separation",
  });

  console.log("\n=== DIRECT BUFFER VALIDATION ===");
  await tryLoad("source artwork", source);
  await tryLoad("suppressed preview buffer", suppressed.buffer);

  console.log("\n=== EMBED ISOLATION ===");
  await embedIsolationTest("source", source);
  await embedIsolationTest("suppressed", suppressed.buffer);

  console.log("\n=== BRANDED PROOF ===");
  const branded = await generateCustomerProofPdf({
    jobReference: "J-4",
    projectName: "Foamex Panels",
    proofReference: "J-4 Proof v6",
    versionNumber: 6,
    customerMessage: "Foamex Panels Proof v1",
    preflight: buildTestPreflight(),
    sourceBuffer: source,
    sourceFileName: "artwork.pdf",
  });

  await tryLoad("branded proof", branded);

  const outDir = "/tmp/candid-pdf-diagnose";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/source.pdf`, source);
  fs.writeFileSync(`${outDir}/suppressed.pdf`, suppressed.buffer);
  fs.writeFileSync(`${outDir}/branded.pdf`, branded);
  console.log(`\nWrote PDFs to ${outDir}`);
}

await main();
