import { deflateSync, inflateSync } from "node:zlib";

import { logProofGeneratorDebug } from "@/lib/proof-generator/artwork-buffer";
import { tokenizeContentStreamSafe } from "@/lib/proof-generator/content-stream-tokenizer";
import {
  logProofGeneratorStage,
  PROOF_GENERATOR_TIMEOUTS,
  withProofGeneratorTimeout,
} from "@/lib/proof-generator/runtime";
import type { ProductionFeatureSourceType } from "@/lib/proof-generator/types";

export type SuppressCutPathPreviewResult = {
  buffer: Buffer;
  originalCutPathSuppressed: boolean;
  method: "ocg_content_filter" | "separation_content_filter" | "none" | "unsupported_source";
  suppressionReason?: string | null;
};

type ParsedPdfObject = {
  objectNumber: number;
  generation: number;
  header: string;
  stream: Buffer | null;
  absoluteStreamStart: number | null;
  absoluteStreamEnd: number | null;
};

function objectKey(objectNumber: number, generation = 0) {
  return `${objectNumber} ${generation}`;
}

function readStreamLength(header: string) {
  const match = header.match(/\/Length\s+(\d+)/);
  if (!match?.[1]) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

function decompressStream(header: string, stream: Buffer): Buffer {
  const length = readStreamLength(header);
  const bounded = length != null && length >= 0 ? stream.subarray(0, length) : stream;

  if (/\/Filter\s*\/FlateDecode\b/.test(header) || /\/Filter\s*\[\s*\/FlateDecode/.test(header)) {
    try {
      return inflateSync(bounded);
    } catch {
      return bounded;
    }
  }

  return bounded;
}

function parsePdfObjects(buffer: Buffer): Map<string, ParsedPdfObject> {
  const text = buffer.toString("latin1");
  const objects = new Map<string, ParsedPdfObject>();
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const objMatch = /(\d+)\s+(\d+)\s+obj/.exec(text.slice(searchFrom));
    if (!objMatch) {
      break;
    }

    const objectNumber = Number.parseInt(objMatch[1], 10);
    const generation = Number.parseInt(objMatch[2], 10);
    const objStart = searchFrom + objMatch.index;
    const bodyStart = objStart + objMatch[0].length;
    const endObjIndex = text.indexOf("endobj", bodyStart);
    if (endObjIndex < 0) {
      break;
    }

    const body = text.slice(bodyStart, endObjIndex);
    const streamIndex = body.indexOf("stream");
    let header = body;
    let stream: Buffer | null = null;
    let absoluteStreamStart: number | null = null;
    let absoluteStreamEnd: number | null = null;

    if (streamIndex >= 0) {
      header = body.slice(0, streamIndex);
      let contentStart = streamIndex + "stream".length;
      if (body[contentStart] === "\r" && body[contentStart + 1] === "\n") {
        contentStart += 2;
      } else if (body[contentStart] === "\n") {
        contentStart += 1;
      } else if (body[contentStart] === "\r") {
        contentStart += 1;
      }

      const length = readStreamLength(header);
      const absoluteStart = bodyStart + contentStart;
      if (length != null && length >= 0) {
        stream = buffer.subarray(absoluteStart, absoluteStart + length);
        absoluteStreamStart = absoluteStart;
        absoluteStreamEnd = absoluteStart + length;
      } else {
        const endStreamIndex = body.indexOf("endstream", contentStart);
        if (endStreamIndex >= 0) {
          stream = Buffer.from(body.slice(contentStart, endStreamIndex), "latin1");
          absoluteStreamStart = absoluteStart;
          absoluteStreamEnd = bodyStart + endStreamIndex;
        }
      }
    }

    objects.set(objectKey(objectNumber, generation), {
      objectNumber,
      generation,
      header,
      stream,
      absoluteStreamStart,
      absoluteStreamEnd,
    });

    searchFrom = endObjIndex + "endobj".length;
  }

  return objects;
}

function normalizeCutPathName(name: string) {
  return name.trim().replace(/^\//, "").toLowerCase();
}

function cutPathNamesMatch(left: string, right: string) {
  return normalizeCutPathName(left) === normalizeCutPathName(right);
}

function parseOcgNameFromHeader(header: string): string | null {
  const parenMatch = header.match(/\/Name\s*\(([^)]+)\)/);
  if (parenMatch?.[1]) {
    return parenMatch[1];
  }

  const slashMatch = header.match(/\/Name\s*\/([A-Za-z0-9#_+-]+)/i);
  return slashMatch?.[1] ?? null;
}

function buildGlobalOcgRegistry(objects: Map<string, ParsedPdfObject>) {
  const map = new Map<string, string>();

  for (const [key, object] of objects.entries()) {
    if (/\/Type\s*\/OCG\b/.test(object.header)) {
      const name = parseOcgNameFromHeader(object.header);
      if (name) {
        map.set(key, name);
      }
    }
  }

  return map;
}

function extractBalancedDictionary(text: string, startIndex: number) {
  if (text[startIndex] !== "<" || text[startIndex + 1] !== "<") {
    return null;
  }

  let depth = 0;
  for (let index = startIndex; index < text.length - 1; index += 1) {
    if (text[index] === "<" && text[index + 1] === "<") {
      depth += 1;
      index += 1;
      continue;
    }
    if (text[index] === ">" && text[index + 1] === ">") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 2);
      }
      index += 1;
    }
  }

  return null;
}

function resolveColorSpaceName(token: string, colorSpaceMap: Map<string, string>) {
  const raw = token.replace(/^\//, "");
  return colorSpaceMap.get(raw) ?? raw;
}

function resolvePropertyToOcgName(
  propertyName: string,
  propertiesMap: Map<string, string>,
  objects: Map<string, ParsedPdfObject>,
  ocgRegistry: Map<string, string>
): string | null {
  const raw = propertyName.replace(/^\//, "");

  for (const name of ocgRegistry.values()) {
    if (cutPathNamesMatch(name, raw)) {
      return name;
    }
  }

  const mapped = propertiesMap.get(raw);
  if (!mapped) {
    return cutPathNamesMatch(raw, raw) ? raw : null;
  }

  const fromRegistry = ocgRegistry.get(mapped);
  if (fromRegistry) {
    return fromRegistry;
  }

  if (!/^\d+ \d+$/.test(mapped)) {
    return mapped;
  }

  const object = objects.get(mapped);
  if (!object) {
    return null;
  }

  return parseOcgNameFromHeader(object.header);
}

function parsePropertiesMap(header: string, objects: Map<string, ParsedPdfObject>) {
  const map = new Map<string, string>();
  const propertiesIndex = header.indexOf("/Properties");
  if (propertiesIndex < 0) {
    return map;
  }

  const dictStart = header.indexOf("<<", propertiesIndex);
  if (dictStart < 0) {
    return map;
  }

  const propertiesDict = extractBalancedDictionary(header, dictStart);
  if (!propertiesDict) {
    return map;
  }

  const inner = propertiesDict.slice(2, -2);
  let index = 0;

  while (index < inner.length) {
    while (index < inner.length && /\s/.test(inner[index])) {
      index += 1;
    }
    if (inner[index] !== "/") {
      break;
    }

    index += 1;
    let alias = "";
    while (index < inner.length && !/[\s[\]/]/.test(inner[index])) {
      alias += inner[index];
      index += 1;
    }

    while (index < inner.length && /\s/.test(inner[index])) {
      index += 1;
    }

    if (!alias) {
      continue;
    }

    const refMatch = inner.slice(index).match(/^(\d+\s+\d+\s+R)/);
    if (refMatch?.[1]) {
      const parts = refMatch[1].match(/(\d+)\s+(\d+)\s+R/);
      if (parts) {
        map.set(alias, objectKey(Number.parseInt(parts[1], 10), Number.parseInt(parts[2], 10)));
      }
      index += refMatch[1].length;
    }
  }

  for (const [alias, ref] of map.entries()) {
    const object = objects.get(ref);
    const name = object ? parseOcgNameFromHeader(object.header) : null;
    if (name) {
      map.set(alias, name);
    }
  }

  return map;
}

function parseColorSpaceDictionary(
  dictionaryText: string,
  objects: Map<string, ParsedPdfObject>,
  targetMap: Map<string, string>
) {
  const colorSpaceIndex = dictionaryText.indexOf("/ColorSpace");
  if (colorSpaceIndex < 0) {
    return;
  }

  const dictStart = dictionaryText.indexOf("<<", colorSpaceIndex);
  if (dictStart < 0) {
    return;
  }

  const colorSpaceDict = extractBalancedDictionary(dictionaryText, dictStart);
  if (!colorSpaceDict) {
    return;
  }

  const inner = colorSpaceDict.slice(2, -2);
  const separationPattern =
    /\/([A-Za-z0-9#_+-]+)\s*\[\s*\/Separation\s*\/\(([^)]+)\)|\/([A-Za-z0-9#_+-]+)\s*\[\s*\/Separation\s*\/([A-Za-z0-9#_+-]+)/g;

  let match: RegExpExecArray | null;
  while ((match = separationPattern.exec(inner)) !== null) {
    const alias = match[1] ?? match[3];
    const name = match[2] ?? match[4];
    if (alias && name) {
      targetMap.set(alias, name);
    }
  }

  const refPattern = /\/([A-Za-z0-9#_+-]+)\s+(\d+)\s+(\d+)\s+R/g;
  while ((match = refPattern.exec(inner)) !== null) {
    const alias = match[1];
    const object = objects.get(
      objectKey(Number.parseInt(match[2], 10), Number.parseInt(match[3], 10))
    );
    if (!object) {
      continue;
    }

    const separationMatch = object.header.match(
      /\/Separation\s*\/\(([^)]+)\)|\/Separation\s*\/([A-Za-z0-9#_+-]+)/
    );
    const name = separationMatch?.[1] ?? separationMatch?.[2];
    if (name) {
      targetMap.set(alias, name);
    }
  }
}

function resolveStreamResourceMaps(input: {
  pageHeader: string;
  streamHeader: string;
  objects: Map<string, ParsedPdfObject>;
}) {
  const colorSpaceMap = new Map<string, string>();
  const propertiesMap = new Map<string, string>();

  parseColorSpaceDictionary(input.pageHeader, input.objects, colorSpaceMap);
  parseColorSpaceDictionary(input.streamHeader, input.objects, colorSpaceMap);
  parsePropertiesMap(input.pageHeader, input.objects).forEach((value, key) => {
    propertiesMap.set(key, value);
  });
  parsePropertiesMap(input.streamHeader, input.objects).forEach((value, key) => {
    propertiesMap.set(key, value);
  });

  return { colorSpaceMap, propertiesMap };
}

const PATH_PAINT_OPERATORS = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"]);
const PATH_BUILD_OPERATORS = new Set(["m", "l", "c", "v", "y", "re", "h"]);

function isContentOperandToken(token: string) {
  return (
    !Number.isNaN(Number.parseFloat(token)) ||
    token.startsWith("/") ||
    token.startsWith("(") ||
    token.startsWith("<")
  );
}

const ARTWORK_CONTENT_PATTERNS = [
  /\brg\b/,
  /\bRG\b/,
  /\bk\b/,
  /\bK\b/,
  /\bre\s+f\b/,
  /\bre\s+f\*\b/,
  /\bDo\b/,
  /\bTj\b/,
  /\bTJ\b/,
  /\bsh\b/,
];

const ARTWORK_PAINT_PATTERNS = [
  /\bre\s+f\b/,
  /\bre\s+f\*\b/,
  /\bf\b/,
  /\bF\b/,
  /\bDo\b/,
  /\bTj\b/,
  /\bTJ\b/,
  /\bsh\b/,
];

function estimatePreviewContentScore(buffer: Buffer) {
  const objects = parsePdfObjects(buffer);
  const pageObject = findFirstPageObject(objects);
  if (!pageObject) {
    return { totalBytes: 0, artworkSignals: 0, artworkPaintSignals: 0 };
  }

  let totalBytes = 0;
  let artworkSignals = 0;
  let artworkPaintSignals = 0;

  for (const streamKey of collectStreamObjectKeys(pageObject.header, objects)) {
    const object = objects.get(streamKey);
    if (!object?.stream) {
      continue;
    }

    const content = decompressStream(object.header, object.stream).toString("latin1");
    totalBytes += content.replace(/\s+/g, "").length;

    for (const pattern of ARTWORK_CONTENT_PATTERNS) {
      if (pattern.test(content)) {
        artworkSignals += 1;
      }
    }

    for (const pattern of ARTWORK_PAINT_PATTERNS) {
      if (pattern.test(content)) {
        artworkPaintSignals += 1;
      }
    }
  }

  return { totalBytes, artworkSignals, artworkPaintSignals };
}

function validateSuppressionPreservesArtwork(
  originalBuffer: Buffer,
  suppressedBuffer: Buffer
): { ok: true } | { ok: false; reason: string } {
  const originalScore = estimatePreviewContentScore(originalBuffer);
  const suppressedScore = estimatePreviewContentScore(suppressedBuffer);

  if (originalScore.artworkPaintSignals === 0) {
    return { ok: true };
  }

  if (suppressedScore.artworkPaintSignals === 0) {
    return {
      ok: false,
      reason: "suppression removed all visible artwork paint operators from the preview",
    };
  }

  if (
    originalScore.totalBytes > 80 &&
    suppressedScore.totalBytes < originalScore.totalBytes * 0.08
  ) {
    return {
      ok: false,
      reason: "suppression removed an unreasonable share of page content",
    };
  }

  return { ok: true };
}

function filterContentStream(input: {
  content: string;
  targetCutPathName: string;
  mode: "optional_content_group" | "separation";
  colorSpaceMap: Map<string, string>;
  propertiesMap: Map<string, string>;
  objects: Map<string, ParsedPdfObject>;
  ocgRegistry: Map<string, string>;
}): { filtered: string; changed: boolean } | { error: string } {
  const tokenizeResult = tokenizeContentStreamSafe(input.content);
  if (!tokenizeResult.ok) {
    return { error: tokenizeResult.reason };
  }
  const tokens = tokenizeResult.tokens;
  const output: string[] = [];
  const operands: string[] = [];
  const ocgSuppressDepth: boolean[] = [];
  let strokeUsesTarget = false;
  let fillUsesTarget = false;
  let pendingPath: string[] = [];
  let changed = false;

  function activeOcgSuppressed() {
    return ocgSuppressDepth.some(Boolean);
  }

  function flushPath(asPaint: boolean) {
    if (pendingPath.length === 0) {
      return;
    }

    const suppressSeparation =
      asPaint && input.mode === "separation" && (strokeUsesTarget || fillUsesTarget);
    const suppressOcg =
      asPaint && input.mode === "optional_content_group" && activeOcgSuppressed();

    if (suppressSeparation || suppressOcg) {
      changed = true;
    } else {
      output.push(...pendingPath);
    }

    pendingPath = [];
  }

  for (const token of tokens) {
    if (isContentOperandToken(token)) {
      operands.push(token);
      continue;
    }

    const operator = token;

    if (operator === "q") {
      flushPath(false);
      output.push("q");
      operands.length = 0;
      continue;
    }

    if (operator === "Q") {
      flushPath(false);
      output.push("Q");
      operands.length = 0;
      continue;
    }

    if (operator === "CS" && operands.length >= 1) {
      flushPath(false);
      const colorSpace = resolveColorSpaceName(operands.at(-1) ?? "", input.colorSpaceMap);
      strokeUsesTarget = cutPathNamesMatch(colorSpace, input.targetCutPathName);
      output.push(...operands, operator);
      operands.length = 0;
      continue;
    }

    if (operator === "cs" && operands.length >= 1) {
      flushPath(false);
      const colorSpace = resolveColorSpaceName(operands.at(-1) ?? "", input.colorSpaceMap);
      fillUsesTarget = cutPathNamesMatch(colorSpace, input.targetCutPathName);
      output.push(...operands, operator);
      operands.length = 0;
      continue;
    }

    if (["SC", "SCN", "sc", "scn"].includes(operator)) {
      flushPath(false);
      output.push(...operands, operator);
      operands.length = 0;
      continue;
    }

    if (operator === "BDC") {
      flushPath(false);
      let suppress = false;
      const ocIndex = operands.findIndex((operand) => operand === "/OC" || operand === "OC");
      const propertyToken =
        ocIndex >= 0 && ocIndex + 1 < operands.length
          ? operands[ocIndex + 1]
          : operands.at(-1) ?? "";
      const ocgName = resolvePropertyToOcgName(
        propertyToken,
        input.propertiesMap,
        input.objects,
        input.ocgRegistry
      );
      if (
        input.mode === "optional_content_group" &&
        ocgName &&
        cutPathNamesMatch(ocgName, input.targetCutPathName)
      ) {
        suppress = true;
        changed = true;
      }

      ocgSuppressDepth.push(suppress);
      output.push(...operands, operator);
      operands.length = 0;
      continue;
    }

    if (operator === "BMC") {
      flushPath(false);
      const propertyToken = operands.at(-1) ?? "";
      const ocgName = resolvePropertyToOcgName(
        propertyToken,
        input.propertiesMap,
        input.objects,
        input.ocgRegistry
      );
      const suppress =
        input.mode === "optional_content_group" &&
        ocgName != null &&
        cutPathNamesMatch(ocgName, input.targetCutPathName);

      ocgSuppressDepth.push(suppress);
      output.push(...operands, operator);
      if (suppress) {
        changed = true;
      }
      operands.length = 0;
      continue;
    }

    if (operator === "EMC") {
      flushPath(false);
      ocgSuppressDepth.pop();
      output.push(operator);
      operands.length = 0;
      continue;
    }

    if (PATH_BUILD_OPERATORS.has(operator)) {
      pendingPath.push(...operands, operator);
      operands.length = 0;
      continue;
    }

    if (PATH_PAINT_OPERATORS.has(operator)) {
      pendingPath.push(...operands, operator);
      flushPath(true);
      operands.length = 0;
      continue;
    }

    flushPath(false);
    output.push(...operands, operator);
    operands.length = 0;
  }

  flushPath(false);

  return {
    filtered: output.join(" "),
    changed,
  };
}

const MAX_PREVIEW_STREAMS_TO_FILTER = 48;

function collectStreamObjectKeys(
  rootHeader: string,
  objects: Map<string, ParsedPdfObject>,
  visited = new Set<string>()
): string[] {
  const keys = new Set<string>();
  const queue: string[] = [];

  const contentsMatch = rootHeader.match(/\/Contents\s+(\d+\s+\d+\s+R)/);
  if (contentsMatch?.[1]) {
    const parts = contentsMatch[1].match(/(\d+)\s+(\d+)\s+R/);
    if (parts) {
      queue.push(objectKey(Number.parseInt(parts[1], 10), Number.parseInt(parts[2], 10)));
    }
  }

  const xObjectPattern = /\/XObject\s*<<([^>]*)>>/g;
  let xObjectMatch: RegExpExecArray | null;
  while ((xObjectMatch = xObjectPattern.exec(rootHeader)) !== null) {
    const refs = xObjectMatch[1].matchAll(/\/([A-Za-z0-9#_+-]+)\s+(\d+\s+\d+\s+R)/g);
    for (const ref of refs) {
      const parts = ref[2].match(/(\d+)\s+(\d+)\s+R/);
      if (parts) {
        queue.push(objectKey(Number.parseInt(parts[1], 10), Number.parseInt(parts[2], 10)));
      }
    }
  }

  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || visited.has(key)) {
      continue;
    }

    visited.add(key);
    const object = objects.get(key);
    if (!object?.stream) {
      continue;
    }

    keys.add(key);

    const nestedXObjects = object.header.matchAll(/\/XObject\s*<<([^>]*)>>/g);
    for (const nested of nestedXObjects) {
      const refs = nested[1].matchAll(/\/([A-Za-z0-9#_+-]+)\s+(\d+\s+\d+\s+R)/g);
      for (const ref of refs) {
        const parts = ref[2].match(/(\d+)\s+(\d+)\s+R/);
        if (parts) {
          queue.push(objectKey(Number.parseInt(parts[1], 10), Number.parseInt(parts[2], 10)));
        }
      }
    }
  }

  return [...keys];
}

function replaceStreamBytes(
  buffer: Buffer,
  object: ParsedPdfObject,
  nextStreamBytes: Buffer
): Buffer {
  if (
    object.absoluteStreamStart == null ||
    object.absoluteStreamEnd == null ||
    object.absoluteStreamStart >= object.absoluteStreamEnd
  ) {
    return buffer;
  }

  const text = buffer.toString("latin1");
  const objectMarker = `${object.objectNumber} ${object.generation} obj`;
  const objectStart = text.lastIndexOf(objectMarker, object.absoluteStreamStart);
  if (objectStart < 0) {
    return buffer;
  }

  const headerEnd = object.absoluteStreamStart;
  const updatedHeader = text
    .slice(objectStart, headerEnd)
    .replace(/\/Length\s+\d+/, `/Length ${nextStreamBytes.length}`);

  return Buffer.from(
    Buffer.concat([
      buffer.subarray(0, objectStart),
      Buffer.from(updatedHeader, "latin1"),
      nextStreamBytes,
      buffer.subarray(object.absoluteStreamEnd),
    ])
  );
}

function findFirstPageObject(objects: Map<string, ParsedPdfObject>) {
  for (const object of objects.values()) {
    if (/\/Type\s*\/Page\b/.test(object.header) && !/\/Type\s*\/Pages\b/.test(object.header)) {
      return object;
    }
  }

  return null;
}

export async function resolveCustomerArtworkPreviewBuffer(
  sourceBuffer: Buffer,
  confirmedCutPath: { name: string; sourceType: ProductionFeatureSourceType } | null,
  options?: { requireVisibleText?: boolean }
): Promise<SuppressCutPathPreviewResult & { previewBuffer: Buffer }> {
  const suppression = await createCustomerPreviewPdfBuffer(sourceBuffer, confirmedCutPath);

  if (!suppression.originalCutPathSuppressed) {
    return { ...suppression, previewBuffer: sourceBuffer };
  }

  const { rasterizePdfPageToPng, validateFlattenedArtworkPreview } = await import(
    "@/lib/proof-generator/rasterize-pdf-page"
  );

  const [originalRaster, suppressedRaster] = await Promise.all([
    rasterizePdfPageToPng(sourceBuffer, 0),
    rasterizePdfPageToPng(suppression.buffer, 0),
  ]);

  if (
    Math.abs(originalRaster.pageWidthPt - suppressedRaster.pageWidthPt) > 0.5 ||
    Math.abs(originalRaster.pageHeightPt - suppressedRaster.pageHeightPt) > 0.5
  ) {
    const reason = "suppressed preview changed page dimensions";
    logProofGeneratorStage("cut-path suppression skipped/fallback", { reason });
    logProofGeneratorDebug("cut_path_preview_suppression_rejected", { reason });
    return {
      buffer: sourceBuffer,
      previewBuffer: sourceBuffer,
      originalCutPathSuppressed: false,
      method: suppression.method,
      suppressionReason: reason,
    };
  }

  const previewValidation = await validateFlattenedArtworkPreview({
    sourceBuffer,
    pngBuffer: suppressedRaster.pngBuffer,
    rgbaData: suppressedRaster.rgbaData,
    renderedWidthPx: suppressedRaster.widthPx,
    renderedHeightPx: suppressedRaster.heightPx,
    requireVisibleText: options?.requireVisibleText,
  });

  if (!previewValidation.ok) {
    logProofGeneratorStage("cut-path suppression skipped/fallback", {
      reason: previewValidation.reason,
    });
    logProofGeneratorDebug("cut_path_preview_suppression_rejected", {
      reason: previewValidation.reason,
    });
    return {
      buffer: sourceBuffer,
      previewBuffer: sourceBuffer,
      originalCutPathSuppressed: false,
      method: suppression.method,
      suppressionReason: previewValidation.reason,
    };
  }

  logProofGeneratorStage("cut-path suppression applied", {
    cutPathName: confirmedCutPath?.name,
    method: suppression.method,
  });

  return {
    ...suppression,
    previewBuffer: suppression.buffer,
  };
}

export async function createCustomerPreviewPdfBuffer(
  sourceBuffer: Buffer,
  confirmedCutPath: { name: string; sourceType: ProductionFeatureSourceType } | null
): Promise<SuppressCutPathPreviewResult> {
  if (!confirmedCutPath) {
    return { buffer: sourceBuffer, originalCutPathSuppressed: false, method: "none" };
  }

  const mode =
    confirmedCutPath.sourceType === "optional_content_group"
      ? "optional_content_group"
      : confirmedCutPath.sourceType === "separation" ||
          confirmedCutPath.sourceType === "spot_colour"
        ? "separation"
        : null;

  if (!mode) {
    return {
      buffer: sourceBuffer,
      originalCutPathSuppressed: false,
      method: "unsupported_source",
    };
  }

  return withProofGeneratorTimeout(
    "OCG suppression",
    PROOF_GENERATOR_TIMEOUTS.ocgSuppressionMs,
    async () =>
      createCustomerPreviewPdfBufferInternal(sourceBuffer, confirmedCutPath, mode)
  );
}

function createCustomerPreviewPdfBufferInternal(
  sourceBuffer: Buffer,
  confirmedCutPath: { name: string; sourceType: ProductionFeatureSourceType },
  mode: "optional_content_group" | "separation"
): SuppressCutPathPreviewResult {
  const fallbackMethod =
    mode === "optional_content_group" ? "ocg_content_filter" : "separation_content_filter";

  try {
    return createCustomerPreviewPdfBufferInternalUnsafe(
      sourceBuffer,
      confirmedCutPath,
      mode,
      fallbackMethod
    );
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "content stream could not be safely parsed";
    logProofGeneratorStage("cut-path suppression skipped/fallback", { reason });
    logProofGeneratorDebug("cut_path_preview_suppression_parse_failed", { reason });
    return {
      buffer: sourceBuffer,
      originalCutPathSuppressed: false,
      method: fallbackMethod,
      suppressionReason: reason,
    };
  }
}

function createCustomerPreviewPdfBufferInternalUnsafe(
  sourceBuffer: Buffer,
  confirmedCutPath: { name: string; sourceType: ProductionFeatureSourceType },
  mode: "optional_content_group" | "separation",
  fallbackMethod: "ocg_content_filter" | "separation_content_filter"
): SuppressCutPathPreviewResult {
  const objects = parsePdfObjects(sourceBuffer);
  const pageObject = findFirstPageObject(objects);
  if (!pageObject) {
    return { buffer: sourceBuffer, originalCutPathSuppressed: false, method: "none" };
  }

  const ocgRegistry = buildGlobalOcgRegistry(objects);
  const streamKeys = collectStreamObjectKeys(pageObject.header, objects).slice(
    0,
    MAX_PREVIEW_STREAMS_TO_FILTER
  );
  let workingBuffer: Buffer = Buffer.from(sourceBuffer);
  let workingObjects = objects;
  let changedAny = false;

  logProofGeneratorStage("cut-path suppression attempted", {
    streamCount: streamKeys.length,
    cutPathName: confirmedCutPath.name,
    mode,
  });

  for (const streamKey of streamKeys) {
    const object = workingObjects.get(streamKey);
    if (!object?.stream) {
      continue;
    }

    const decompressed = decompressStream(object.header, object.stream);
    const content = decompressed.toString("latin1");
    const { colorSpaceMap, propertiesMap } = resolveStreamResourceMaps({
      pageHeader: pageObject.header,
      streamHeader: object.header,
      objects: workingObjects,
    });
    const filterResult = filterContentStream({
      content,
      targetCutPathName: confirmedCutPath.name,
      mode,
      colorSpaceMap,
      propertiesMap,
      objects: workingObjects,
      ocgRegistry,
    });

    if ("error" in filterResult) {
      logProofGeneratorStage("cut-path suppression skipped/fallback", {
        reason: filterResult.error,
        streamKey,
      });
      return {
        buffer: sourceBuffer,
        originalCutPathSuppressed: false,
        method: fallbackMethod,
        suppressionReason: filterResult.error,
      };
    }

    const { filtered, changed } = filterResult;

    if (!changed) {
      continue;
    }

    changedAny = true;
    const usesFlate =
      /\/Filter\s*\/FlateDecode\b/.test(object.header) ||
      /\/Filter\s*\[\s*\/FlateDecode/.test(object.header);
    const nextBytes = Buffer.from(
      usesFlate ? deflateSync(Buffer.from(filtered, "latin1")) : Buffer.from(filtered, "latin1")
    );

    workingBuffer = replaceStreamBytes(workingBuffer, object, nextBytes);
    workingObjects = parsePdfObjects(workingBuffer);

    logProofGeneratorDebug("cut_path_preview_stream_filtered", {
      streamKey,
      mode,
      cutPathName: confirmedCutPath.name,
      bytesBefore: object.stream.length,
      bytesAfter: nextBytes.length,
    });
  }

  if (!changedAny) {
    return {
      buffer: sourceBuffer,
      originalCutPathSuppressed: false,
      method: mode === "optional_content_group" ? "ocg_content_filter" : "separation_content_filter",
    };
  }

  const validation = validateSuppressionPreservesArtwork(sourceBuffer, workingBuffer);
  if (!validation.ok) {
    logProofGeneratorStage("cut-path suppression skipped/fallback", {
      reason: validation.reason,
    });
    logProofGeneratorDebug("cut_path_preview_suppression_rejected", {
      reason: validation.reason,
      cutPathName: confirmedCutPath.name,
      mode,
    });
    return {
      buffer: sourceBuffer,
      originalCutPathSuppressed: false,
      method: fallbackMethod,
      suppressionReason: validation.reason,
    };
  }

  return {
    buffer: workingBuffer,
    originalCutPathSuppressed: true,
    method: mode === "optional_content_group" ? "ocg_content_filter" : "separation_content_filter",
  };
}
