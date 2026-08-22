import type { PdfBoxDimensions } from "@/lib/proof-generator/types";

/** ASCII placeholder for missing values in generated proof PDFs. */
export const PDF_MISSING_VALUE = "-";

const EXPLICIT_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201A", "'"],
  ["\u201B", "'"],
  ["\u201C", '"'],
  ["\u201D", '"'],
  ["\u201E", '"'],
  ["\u2032", "'"],
  ["\u2033", '"'],
  ["\u2013", "-"],
  ["\u2014", "-"],
  ["\u2212", "-"],
  ["\u2026", "..."],
  ["\u00A0", " "],
  ["\u00D7", "x"],
  ["\u00B7", " | "],
  ["\u2192", "->"],
  ["\u2190", "<-"],
  ["\u26A0", "WARNING"],
  ["\u2713", "PASS"],
  ["\u2714", "PASS"],
  ["\u2022", "-"],
  ["\u25CF", "-"],
  ["\u2015", "-"],
  ["\uFEFF", ""],
];

/**
 * Helvetica StandardFonts in pdf-lib use WinAnsi encoding. Normalise dynamic and
 * static strings before drawText so customer/project names and preflight lines
 * do not crash generation on unsupported Unicode symbols.
 */
export function sanitizePdfText(value: string | null | undefined): string {
  if (value == null) {
    return "";
  }

  let text = String(value).normalize("NFKC");

  for (const [from, to] of EXPLICIT_REPLACEMENTS) {
    if (text.includes(from)) {
      text = text.split(from).join(to);
    }
  }

  return text.replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/g, "?");
}

export function statusPrefixForCheck(status: string): string {
  switch (status) {
    case "pass":
      return "PASS -";
    case "warning":
      return "WARNING -";
    case "manual_review":
      return "REVIEW -";
    default:
      return "-";
  }
}

export function formatPdfDimensionsLabel(
  widthMm: number | null | undefined,
  heightMm: number | null | undefined
): string {
  if (widthMm == null || heightMm == null) {
    return PDF_MISSING_VALUE;
  }

  return sanitizePdfText(`${widthMm} x ${heightMm} mm`);
}

export function formatPdfDimensionsFromBox(dimensions: PdfBoxDimensions | null): string {
  if (!dimensions) {
    return PDF_MISSING_VALUE;
  }

  return formatPdfDimensionsLabel(dimensions.widthMm, dimensions.heightMm);
}

export function joinPdfParts(parts: Array<string | null | undefined>, separator = " | "): string {
  return sanitizePdfText(parts.filter(Boolean).join(separator) || PDF_MISSING_VALUE);
}

export function formatPreflightCheckLine(input: {
  status: string;
  label: string;
  message: string;
}): string {
  return sanitizePdfText(
    `${statusPrefixForCheck(input.status)} ${input.label}: ${input.message}`
  );
}
