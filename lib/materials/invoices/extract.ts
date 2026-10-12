import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { InvoiceExtractionStatus } from "@/lib/materials/invoices/model";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

export function resolvePdfJsRoot() {
  const nodeModulesRoot = path.join(process.cwd(), "node_modules");
  const direct = path.join(nodeModulesRoot, "pdfjs-dist");

  if (existsSync(path.join(direct, "package.json"))) {
    return direct;
  }

  if (existsSync(nodeModulesRoot)) {
    for (const entry of readdirSync(nodeModulesRoot)) {
      if (entry === "pdfjs-dist" || entry.startsWith("pdfjs-dist-")) {
        const candidate = path.join(nodeModulesRoot, entry);

        if (existsSync(path.join(candidate, "package.json"))) {
          return candidate;
        }
      }
    }
  }

  throw new Error("pdfjs-dist could not be resolved from node_modules.");
}

export async function extractInvoiceDocument(input: {
  bytes: Uint8Array;
  mimeType: string;
}) {
  if (IMAGE_TYPES.has(input.mimeType)) {
    return {
      text: null,
      extractionStatus: "needs_ocr" as InvoiceExtractionStatus,
      warnings: [
        "This is an image invoice. OCR is not connected yet, so no lines were invented. You can add lines from the original image.",
      ],
    };
  }

  if (input.mimeType !== "application/pdf") {
    return {
      text: null,
      extractionStatus: "failed" as InvoiceExtractionStatus,
      warnings: ["This file type cannot be read."],
    };
  }

  try {
    const text = await extractPdfText(input.bytes);

    if (!text.trim()) {
      return {
        text: null,
        extractionStatus: "needs_ocr" as InvoiceExtractionStatus,
        warnings: [
          "This PDF has no text layer. OCR is not connected yet, so no lines were invented.",
        ],
      };
    }

    return {
      text,
      extractionStatus: "extracted" as InvoiceExtractionStatus,
      warnings: [] as string[],
    };
  } catch {
    return {
      text: null,
      extractionStatus: "failed" as InvoiceExtractionStatus,
      warnings: ["The PDF could not be read."],
    };
  }
}

export async function extractPdfText(bytes: Uint8Array) {
  const pdfjsRoot = resolvePdfJsRoot();
  const document = await getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: pathToFileURL(path.join(pdfjsRoot, "standard_fonts/")).href,
    cMapUrl: pathToFileURL(path.join(pdfjsRoot, "cmaps/")).href,
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const positioned = content.items.flatMap((item) => {
      if (!("str" in item)) {
        return [];
      }

      const x = Array.isArray(item.transform) ? item.transform[4] : 0;
      const y = Array.isArray(item.transform) ? item.transform[5] : 0;
      return [{ text: item.str, x, y }];
    });
    pages.push(joinPositionedText(positioned));
  }

  if (typeof document.cleanup === "function") {
    await document.cleanup();
  }

  return pages.join("\n");
}

export function joinPositionedText(items: Array<{ text: string; x?: number; y: number }>) {
  const rows: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = [];

  items.forEach((item, index) => {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) < 2);
    const part = { x: item.x ?? index, text: item.text };

    if (row) {
      row.parts.push(part);
    } else {
      rows.push({ y: item.y, parts: [part] });
    }
  });

  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) =>
      row.parts
        .sort((left, right) => left.x - right.x)
        .map((part) => part.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}
