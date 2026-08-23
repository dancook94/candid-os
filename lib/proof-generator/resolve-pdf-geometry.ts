import { PT_TO_MM } from "@/lib/proof-generator/constants";
import type {
  DetectedArtworkMetadata,
  DetectedConfidence,
  DetectedValue,
  PdfBoxDimensions,
} from "@/lib/proof-generator/types";

export type FinishedSizeSource =
  | "trim_box"
  | "art_box"
  | "crop_marks"
  | "crop_box"
  | "media_box";

export type PdfBoxRect = PdfBoxDimensions & {
  x1Pt: number;
  y1Pt: number;
  x2Pt: number;
  y2Pt: number;
};

export type ResolvedPdfGeometry = {
  finishedSize: DetectedValue<PdfBoxDimensions | null>;
  finishedSizeSource: DetectedValue<FinishedSizeSource | null>;
  bleedAllowanceMm: DetectedValue<number | null>;
};

function detected<T>(
  value: T,
  confidence: DetectedConfidence,
  source: string
): DetectedValue<T> {
  return { value, confidence, source };
}

function pointsToMm(value: number) {
  return Math.round(value * PT_TO_MM * 100) / 100;
}

function dimensionsFromPoints(widthPt: number, heightPt: number): PdfBoxDimensions {
  return {
    widthPt: Math.round(widthPt * 100) / 100,
    heightPt: Math.round(heightPt * 100) / 100,
    widthMm: pointsToMm(widthPt),
    heightMm: pointsToMm(heightPt),
  };
}

function boxFromRect(x1: number, y1: number, x2: number, y2: number): PdfBoxRect {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const bottom = Math.min(y1, y2);
  const top = Math.max(y1, y2);
  const widthPt = right - left;
  const heightPt = top - bottom;

  return {
    ...dimensionsFromPoints(widthPt, heightPt),
    x1Pt: Math.round(left * 100) / 100,
    y1Pt: Math.round(bottom * 100) / 100,
    x2Pt: Math.round(right * 100) / 100,
    y2Pt: Math.round(top * 100) / 100,
  };
}

function isValidFinishedBox(
  box: PdfBoxDimensions | null,
  pageSize: PdfBoxDimensions | null
) {
  if (!box || box.widthPt <= 0 || box.heightPt <= 0) {
    return false;
  }

  if (!pageSize) {
    return true;
  }

  return box.widthPt <= pageSize.widthPt + 0.5 && box.heightPt <= pageSize.heightPt + 0.5;
}

function artBoxRepresentsFinishedArtwork(
  artBox: PdfBoxDimensions | null,
  pageSize: PdfBoxDimensions | null
) {
  if (!artBox || !pageSize || !isValidFinishedBox(artBox, pageSize)) {
    return false;
  }

  const widthRatio = artBox.widthPt / pageSize.widthPt;
  const heightRatio = artBox.heightPt / pageSize.heightPt;

  if (widthRatio >= 0.98 && heightRatio >= 0.98) {
    return false;
  }

  const widthDelta = Math.abs(artBox.widthMm - pageSize.widthMm);
  const heightDelta = Math.abs(artBox.heightMm - pageSize.heightMm);

  return widthDelta >= 1 || heightDelta >= 1;
}

export function computeBleedAllowanceFromBoxes(input: {
  finishedSize: PdfBoxDimensions | null;
  bleedBox: PdfBoxDimensions | null;
  pageSize: PdfBoxDimensions | null;
}) {
  if (input.finishedSize && input.bleedBox) {
    const horizontal = Math.max(
      0,
      Math.round(((input.bleedBox.widthMm - input.finishedSize.widthMm) / 2) * 100) / 100
    );
    const vertical = Math.max(
      0,
      Math.round(((input.bleedBox.heightMm - input.finishedSize.heightMm) / 2) * 100) / 100
    );

    if (horizontal > 0 || vertical > 0) {
      return Math.max(horizontal, vertical);
    }
  }

  if (input.finishedSize && input.pageSize) {
    const horizontal = Math.max(
      0,
      Math.round(((input.pageSize.widthMm - input.finishedSize.widthMm) / 2) * 100) / 100
    );
    const vertical = Math.max(
      0,
      Math.round(((input.pageSize.heightMm - input.finishedSize.heightMm) / 2) * 100) / 100
    );

    if (horizontal > 0 || vertical > 0) {
      return Math.max(horizontal, vertical);
    }
  }

  return null;
}

type LineSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
};

function parseNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenizeContentStream(content: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < content.length) {
    const char = content[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "%") {
      while (index < content.length && content[index] !== "\n" && content[index] !== "\r") {
        index += 1;
      }
      continue;
    }

    if (char === "(") {
      index += 1;
      let depth = 1;
      while (index < content.length && depth > 0) {
        if (content[index] === "\\") {
          index += 2;
          continue;
        }
        if (content[index] === "(") {
          depth += 1;
        }
        if (content[index] === ")") {
          depth -= 1;
        }
        index += 1;
      }
      continue;
    }

    if (char === "<") {
      index += 1;
      if (content[index] === "<") {
        index += 1;
        while (index < content.length && !(content[index] === ">" && content[index + 1] === ">")) {
          index += 1;
        }
        index += 2;
        continue;
      }

      while (index < content.length && content[index] !== ">") {
        index += 1;
      }
      index += 1;
      continue;
    }

    let token = "";
    while (index < content.length && !/[\s<>()[%]/.test(content[index])) {
      token += content[index];
      index += 1;
    }

    if (token) {
      tokens.push(token);
    }
  }

  return tokens;
}

function extractLineSegments(content: string): LineSegment[] {
  const tokens = tokenizeContentStream(content);
  const segments: LineSegment[] = [];
  const operands: string[] = [];
  let currentPoint: { x: number; y: number } | null = null;

  for (const token of tokens) {
    if (!Number.isNaN(Number.parseFloat(token)) || token.startsWith("/")) {
      operands.push(token);
      continue;
    }

    if (token === "m" && operands.length >= 2) {
      const x = parseNumber(operands.at(-2) ?? "");
      const y = parseNumber(operands.at(-1) ?? "");
      if (x != null && y != null) {
        currentPoint = { x, y };
      }
      operands.length = 0;
      continue;
    }

    if (token === "l" && operands.length >= 2 && currentPoint) {
      const x = parseNumber(operands.at(-2) ?? "");
      const y = parseNumber(operands.at(-1) ?? "");
      if (x != null && y != null) {
        const length = Math.hypot(x - currentPoint.x, y - currentPoint.y);
        segments.push({
          x1: currentPoint.x,
          y1: currentPoint.y,
          x2: x,
          y2: y,
          length,
        });
        currentPoint = { x, y };
      }
      operands.length = 0;
      continue;
    }

    if (token === "re" && operands.length >= 4) {
      const x = parseNumber(operands.at(-4) ?? "");
      const y = parseNumber(operands.at(-3) ?? "");
      const width = parseNumber(operands.at(-2) ?? "");
      const height = parseNumber(operands.at(-1) ?? "");
      if (x != null && y != null && width != null && height != null) {
        const corners = [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
        ];
        for (let index = 0; index < corners.length; index += 1) {
          const start = corners[index];
          const end = corners[(index + 1) % corners.length];
          segments.push({
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            length: Math.hypot(end.x - start.x, end.y - start.y),
          });
        }
      }
      operands.length = 0;
      continue;
    }

    operands.length = 0;
  }

  return segments;
}

function detectCropMarksTrimRect(
  buffer: Buffer,
  pageSize: PdfBoxDimensions | null
): { box: PdfBoxDimensions; confidence: DetectedConfidence } | null {
  if (!pageSize) {
    return null;
  }

  const content = buffer.toString("latin1");
  const segments = extractLineSegments(content).filter(
    (segment) => segment.length >= 3 && segment.length <= 80
  );

  if (segments.length < 8) {
    return null;
  }

  const pageWidth = pageSize.widthPt;
  const pageHeight = pageSize.heightPt;
  const margin = Math.min(pageWidth, pageHeight) * 0.2;

  const nearLeft = segments.filter(
    (segment) => Math.min(segment.x1, segment.x2) <= margin
  );
  const nearRight = segments.filter(
    (segment) => Math.max(segment.x1, segment.x2) >= pageWidth - margin
  );
  const nearBottom = segments.filter(
    (segment) => Math.min(segment.y1, segment.y2) <= margin
  );
  const nearTop = segments.filter(
    (segment) => Math.max(segment.y1, segment.y2) >= pageHeight - margin
  );

  if (
    nearLeft.length < 2 ||
    nearRight.length < 2 ||
    nearBottom.length < 2 ||
    nearTop.length < 2
  ) {
    return null;
  }

  const leftInset = Math.max(
    ...nearLeft.flatMap((segment) => [segment.x1, segment.x2])
  );
  const rightInset = Math.min(
    ...nearRight.flatMap((segment) => [segment.x1, segment.x2])
  );
  const bottomInset = Math.max(
    ...nearBottom.flatMap((segment) => [segment.y1, segment.y2])
  );
  const topInset = Math.min(
    ...nearTop.flatMap((segment) => [segment.y1, segment.y2])
  );

  if (
    rightInset <= leftInset + 20 ||
    topInset <= bottomInset + 20 ||
    leftInset <= 0 ||
    bottomInset <= 0 ||
    rightInset >= pageWidth ||
    topInset >= pageHeight
  ) {
    return null;
  }

  const widthPt = rightInset - leftInset;
  const heightPt = topInset - bottomInset;
  const insetRatioX = leftInset / pageWidth;
  const insetRatioY = bottomInset / pageHeight;

  if (
    widthPt >= pageWidth * 0.98 ||
    heightPt >= pageHeight * 0.98 ||
    insetRatioX < 0.005 ||
    insetRatioY < 0.005 ||
    insetRatioX > 0.25 ||
    insetRatioY > 0.25
  ) {
    return null;
  }

  const symmetricX = Math.abs(leftInset - (pageWidth - rightInset)) / pageWidth;
  const symmetricY = Math.abs(bottomInset - (pageHeight - topInset)) / pageHeight;

  if (symmetricX > 0.02 || symmetricY > 0.02) {
    return null;
  }

  return {
    box: dimensionsFromPoints(widthPt, heightPt),
    confidence: "high",
  };
}

export function extractPdfBoxRects(buffer: Buffer): Array<{ name: string; rect: PdfBoxRect }> {
  const text = buffer.toString("latin1");
  const matches: Array<{ name: string; rect: PdfBoxRect }> = [];
  const pattern =
    /\/(MediaBox|CropBox|TrimBox|BleedBox|ArtBox)\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*]/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const [, name, x1, y1, x2, y2] = match;
    const rect = boxFromRect(
      Number.parseFloat(x1),
      Number.parseFloat(y1),
      Number.parseFloat(x2),
      Number.parseFloat(y2)
    );

    if (rect.widthPt > 0 && rect.heightPt > 0) {
      matches.push({ name, rect });
    }
  }

  return matches;
}

function pickFirstBox(
  boxes: Array<{ name: string; rect: PdfBoxRect }>,
  name: string
): PdfBoxRect | null {
  return boxes.find((box) => box.name === name)?.rect ?? null;
}

export function resolveFinishedArtworkSize(input: {
  pageSize: PdfBoxDimensions | null;
  trimBox: PdfBoxDimensions | null;
  artBox: PdfBoxDimensions | null;
  cropBox: PdfBoxDimensions | null;
  mediaBox: PdfBoxDimensions | null;
  bleedBox: PdfBoxDimensions | null;
  sourceBuffer?: Buffer | null;
}): ResolvedPdfGeometry {
  const pageSize = input.pageSize ?? input.mediaBox ?? input.cropBox;

  if (input.trimBox && isValidFinishedBox(input.trimBox, pageSize)) {
    return {
      finishedSize: detected(input.trimBox, "high", "pdf_trim_box"),
      finishedSizeSource: detected("trim_box", "high", "pdf_trim_box"),
      bleedAllowanceMm: detected(
        computeBleedAllowanceFromBoxes({
          finishedSize: input.trimBox,
          bleedBox: input.bleedBox,
          pageSize,
        }),
        input.bleedBox ? "high" : "medium",
        "pdf_trim_box"
      ),
    };
  }

  if (artBoxRepresentsFinishedArtwork(input.artBox, pageSize)) {
    return {
      finishedSize: detected(input.artBox, "medium", "pdf_art_box"),
      finishedSizeSource: detected("art_box", "medium", "pdf_art_box"),
      bleedAllowanceMm: detected(
        computeBleedAllowanceFromBoxes({
          finishedSize: input.artBox,
          bleedBox: input.bleedBox,
          pageSize,
        }),
        "medium",
        "pdf_art_box"
      ),
    };
  }

  if (input.sourceBuffer?.length) {
    const cropMarks = detectCropMarksTrimRect(input.sourceBuffer, pageSize);
    if (cropMarks) {
      return {
        finishedSize: detected(cropMarks.box, cropMarks.confidence, "pdf_crop_marks"),
        finishedSizeSource: detected("crop_marks", cropMarks.confidence, "pdf_crop_marks"),
        bleedAllowanceMm: detected(
          computeBleedAllowanceFromBoxes({
            finishedSize: cropMarks.box,
            bleedBox: input.bleedBox,
            pageSize,
          }),
          "medium",
          "pdf_crop_marks"
        ),
      };
    }
  }

  if (
    input.cropBox &&
    pageSize &&
    isValidFinishedBox(input.cropBox, pageSize) &&
    (input.cropBox.widthPt < pageSize.widthPt - 0.5 ||
      input.cropBox.heightPt < pageSize.heightPt - 0.5)
  ) {
    return {
      finishedSize: detected(input.cropBox, "medium", "pdf_crop_box"),
      finishedSizeSource: detected("crop_box", "medium", "pdf_crop_box"),
      bleedAllowanceMm: detected(
        computeBleedAllowanceFromBoxes({
          finishedSize: input.cropBox,
          bleedBox: input.bleedBox,
          pageSize,
        }),
        "medium",
        "pdf_crop_box"
      ),
    };
  }

  const fallback = pageSize ?? input.mediaBox ?? input.cropBox;

  return {
    finishedSize: detected(fallback, "low", "pdf_media_box"),
    finishedSizeSource: detected("media_box", "low", "pdf_media_box"),
    bleedAllowanceMm: detected(null, "low", "pdf_media_box"),
  };
}

export function enrichMetadataWithResolvedGeometry(
  metadata: DetectedArtworkMetadata,
  sourceBuffer?: Buffer | null
): DetectedArtworkMetadata {
  const resolved = resolveFinishedArtworkSize({
    pageSize: metadata.pageSize.value,
    trimBox: metadata.trimBox.value,
    artBox: metadata.artBox.value,
    cropBox: metadata.cropBox.value,
    mediaBox: metadata.mediaBox.value,
    bleedBox: metadata.bleedBox.value,
    sourceBuffer,
  });

  return {
    ...metadata,
    finishedSize: resolved.finishedSize,
    finishedSizeSource: resolved.finishedSizeSource,
    bleedAllowanceMm: resolved.bleedAllowanceMm,
  };
}

export function formatFinishedSizeSourceLabel(
  source: FinishedSizeSource | null | undefined
): string {
  switch (source) {
    case "trim_box":
      return "PDF TrimBox";
    case "art_box":
      return "PDF ArtBox";
    case "crop_marks":
      return "Crop marks";
    case "crop_box":
      return "PDF CropBox";
    case "media_box":
      return "PDF MediaBox";
    default:
      return "Not determined";
  }
}
