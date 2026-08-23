import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

import { logProofGeneratorDebug } from "@/lib/proof-generator/artwork-buffer";

export type CutPathPathCommand =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | {
      op: "C";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x: number;
      y: number;
    }
  | { op: "Z" };

export type CutPathSubpath = CutPathPathCommand[];

export type CutPathGeometry = {
  subpaths: CutPathSubpath[];
  pageIndex: number;
  mediaBox: { x: number; y: number; width: number; height: number };
  rotation: number;
};

export type CutPathExtractionDiagnostic = {
  separationName: string;
  pageIndex: number;
  pageLocated: boolean;
  contentStreamCount: number;
  formXObjectsVisited: number;
  colorSpaceAliases: Record<string, string>;
  separationOperatorsSeen: number;
  paintedPathsFound: number;
  fallbackStreamsScanned: number;
  failureStage: string;
  detail?: string;
};

export type CutPathExtractionResult =
  | { ok: true; geometry: CutPathGeometry; diagnostic: CutPathExtractionDiagnostic }
  | { ok: false; reason: string; diagnostic: CutPathExtractionDiagnostic };

type Matrix = [number, number, number, number, number, number];

type PaintMode = "stroke" | "fill" | "both";

type GraphicsState = {
  ctm: Matrix;
  strokeColorSpace: string | null;
  fillColorSpace: string | null;
  strokeUsesTarget: boolean;
  fillUsesTarget: boolean;
};

type ParsedPdfObject = {
  objectNumber: number;
  generation: number;
  header: string;
  stream: Buffer | null;
};

type ResourceMaps = {
  colorSpaceMap: Map<string, string>;
  xObjectMap: Map<string, string>;
};

type InterpretLimits = {
  maxDepth: number;
  maxForms: number;
  maxPaths: number;
  maxOperators: number;
};

type InterpretCounters = {
  depth: number;
  formsVisited: number;
  pathsCollected: number;
  operatorsProcessed: number;
  separationOperatorsSeen: number;
};

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

const PATH_PAINT_OPERATORS = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"]);

const DEFAULT_LIMITS: InterpretLimits = {
  maxDepth: 32,
  maxForms: 96,
  maxPaths: 500,
  maxOperators: 750_000,
};

function multiplyMatrix(left: Matrix, right: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

function transformPoint(matrix: Matrix, x: number, y: number) {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  };
}

function normalizeSeparationName(name: string) {
  return name.trim().replace(/^\//, "").toLowerCase();
}

function separationNamesMatch(left: string, right: string) {
  return normalizeSeparationName(left) === normalizeSeparationName(right);
}

function parseNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

  if (/\/Filter\s*\/ASCII85Decode\b/.test(header)) {
    return bounded;
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
      } else {
        const endStreamIndex = body.indexOf("endstream", contentStart);
        if (endStreamIndex >= 0) {
          stream = Buffer.from(body.slice(contentStart, endStreamIndex), "latin1");
        }
      }
    }

    objects.set(objectKey(objectNumber, generation), {
      objectNumber,
      generation,
      header,
      stream,
    });

    searchFrom = endObjIndex + "endobj".length;
  }

  return objects;
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

function extractBalancedArray(text: string, startIndex: number) {
  if (text[startIndex] !== "[") {
    return null;
  }

  let depth = 0;
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === "[") {
      depth += 1;
    } else if (text[index] === "]") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function resolveObjectHeader(
  reference: string,
  objects: Map<string, ParsedPdfObject>,
  visited = new Set<string>()
): string {
  const refMatch = reference.match(/(\d+)\s+(\d+)\s+R/);
  if (!refMatch) {
    return reference;
  }

  const key = objectKey(Number.parseInt(refMatch[1], 10), Number.parseInt(refMatch[2], 10));
  if (visited.has(key)) {
    return "";
  }

  visited.add(key);
  const object = objects.get(key);
  return object?.header ?? "";
}

function parseSeparationNameFromDefinition(definition: string): string | null {
  const separationMatch = definition.match(/\/Separation\s*\/([A-Za-z0-9#_+-]+)/i);
  if (separationMatch?.[1]) {
    return separationMatch[1];
  }

  const inlineMatch = definition.match(/\[\s*\/Separation\s*\/([A-Za-z0-9#_+-]+)/i);
  return inlineMatch?.[1] ?? null;
}

function parseDeviceNComponentNames(definition: string): string[] {
  const deviceNIndex = definition.indexOf("/DeviceN");
  if (deviceNIndex < 0) {
    return [];
  }

  const arrayStart = definition.indexOf("[", deviceNIndex);
  if (arrayStart < 0) {
    return [];
  }

  const namesArray = extractBalancedArray(definition, arrayStart);
  if (!namesArray) {
    return [];
  }

  const names: string[] = [];
  for (const match of namesArray.matchAll(/\/([A-Za-z0-9#_+-]+)/g)) {
    const name = match[1];
    if (!["DeviceN", "DeviceCMYK", "DeviceRGB", "DeviceGray"].includes(name)) {
      names.push(name);
    }
  }

  return names;
}

function registerColorSpaceDefinition(
  alias: string,
  definition: string,
  objects: Map<string, ParsedPdfObject>,
  map: Map<string, string>,
  visited = new Set<string>()
) {
  const trimmed = definition.trim();

  if (trimmed.match(/^\d+\s+\d+\s+R$/)) {
    const header = resolveObjectHeader(trimmed, objects, visited);
    if (header) {
      registerColorSpaceDefinition(alias, header, objects, map, visited);
    }
    return;
  }

  if (trimmed.startsWith("[")) {
    const separationName = parseSeparationNameFromDefinition(trimmed);
    if (separationName) {
      map.set(alias, separationName);
      return;
    }

    for (const component of parseDeviceNComponentNames(trimmed)) {
      map.set(`${alias}:${component}`, component);
      map.set(component, component);
    }
    return;
  }

  if (trimmed.startsWith("/")) {
    map.set(alias, trimmed.slice(1));
    return;
  }

  const separationName = parseSeparationNameFromDefinition(trimmed);
  if (separationName) {
    map.set(alias, separationName);
    return;
  }

  for (const component of parseDeviceNComponentNames(trimmed)) {
    map.set(`${alias}:${component}`, component);
  }
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

    if (inner[index] === "[") {
      const array = extractBalancedArray(inner, index);
      if (array) {
        registerColorSpaceDefinition(alias, array, objects, targetMap);
        index += array.length;
        continue;
      }
    }

    if (inner[index] === "<" && inner[index + 1] === "<") {
      const nested = extractBalancedDictionary(inner, index);
      if (nested) {
        registerColorSpaceDefinition(alias, nested, objects, targetMap);
        index += nested.length;
        continue;
      }
    }

    if (inner[index] === "/") {
      let name = "";
      index += 1;
      while (index < inner.length && !/[\s[\]()<>]/.test(inner[index])) {
        name += inner[index];
        index += 1;
      }
      if (name) {
        targetMap.set(alias, name);
      }
      continue;
    }

    const restMatch = inner.slice(index).match(/^(\d+\s+\d+\s+R)/);
    if (restMatch?.[1]) {
      registerColorSpaceDefinition(alias, restMatch[1], objects, targetMap);
      index += restMatch[1].length;
    }
  }
}

function buildGlobalColorSpaceRegistry(objects: Map<string, ParsedPdfObject>) {
  const map = new Map<string, string>();

  for (const object of objects.values()) {
    parseColorSpaceDictionary(object.header, objects, map);

    const separationName = parseSeparationNameFromDefinition(object.header);
    if (separationName) {
      map.set(separationName, separationName);
    }

    for (const component of parseDeviceNComponentNames(object.header)) {
      map.set(component, component);
    }
  }

  return map;
}

function mergeResourceMaps(base: ResourceMaps, overlay: ResourceMaps): ResourceMaps {
  return {
    colorSpaceMap: new Map([...base.colorSpaceMap, ...overlay.colorSpaceMap]),
    xObjectMap: new Map([...base.xObjectMap, ...overlay.xObjectMap]),
  };
}

function resolveResourcesMaps(
  resourcesHeader: string,
  objects: Map<string, ParsedPdfObject>,
  globalColorSpaces: Map<string, string>,
  visited = new Set<string>()
): ResourceMaps {
  const colorSpaceMap = new Map(globalColorSpaces);
  const xObjectMap = new Map<string, string>();

  if (!resourcesHeader.trim()) {
    return { colorSpaceMap, xObjectMap };
  }

  const inlineDict = resourcesHeader.match(/<<[\s\S]*>>/)?.[0] ?? resourcesHeader;
  parseColorSpaceDictionary(inlineDict, objects, colorSpaceMap);

  const xObjectIndex = inlineDict.indexOf("/XObject");
  if (xObjectIndex >= 0) {
    const dictStart = inlineDict.indexOf("<<", xObjectIndex);
    const xObjectDict = dictStart >= 0 ? extractBalancedDictionary(inlineDict, dictStart) : null;
    if (xObjectDict) {
      for (const match of xObjectDict.matchAll(/\/([A-Za-z0-9_+-]+)\s+(\d+)\s+(\d+)\s+R/g)) {
        xObjectMap.set(
          match[1],
          objectKey(Number.parseInt(match[2], 10), Number.parseInt(match[3], 10))
        );
      }
    }
  }

  const refMatch = resourcesHeader.match(/(\d+)\s+(\d+)\s+R/);
  if (refMatch && !resourcesHeader.includes("<<")) {
    const key = objectKey(Number.parseInt(refMatch[1], 10), Number.parseInt(refMatch[2], 10));
    if (!visited.has(key)) {
      visited.add(key);
      const object = objects.get(key);
      if (object) {
        const nested = resolveResourcesMaps(object.header, objects, globalColorSpaces, visited);
        return mergeResourceMaps({ colorSpaceMap, xObjectMap }, nested);
      }
    }
  }

  return { colorSpaceMap, xObjectMap };
}

function findPageObjectHeaders(buffer: Buffer): string[] {
  const text = buffer.toString("latin1");
  const pageHeaders: string[] = [];
  const pattern = /(\d+\s+\d+\s+obj[\s\S]*?\/Type\s*\/Page(?!\s*s)[\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    pageHeaders.push(match[1]);
  }

  return pageHeaders;
}

function findPagesObjectHeader(buffer: Buffer): string | null {
  const text = buffer.toString("latin1");
  const match = text.match(/(\d+\s+\d+\s+obj[\s\S]*?\/Type\s*\/Pages[\s\S]*?)endobj/);
  return match?.[1] ?? null;
}

function resolveContentsReferences(pageHeader: string): string[] {
  const arrayMatch = pageHeader.match(/\/Contents\s*\[([\s\S]*?)\]/);
  if (arrayMatch?.[1]) {
    return [...arrayMatch[1].matchAll(/(\d+)\s+(\d+)\s+R/g)].map((entry) =>
      objectKey(Number.parseInt(entry[1], 10), Number.parseInt(entry[2], 10))
    );
  }

  const singleMatch = pageHeader.match(/\/Contents\s+(\d+)\s+(\d+)\s+R/);
  if (singleMatch) {
    return [
      objectKey(Number.parseInt(singleMatch[1], 10), Number.parseInt(singleMatch[2], 10)),
    ];
  }

  return [];
}

function resolvePageResources(
  pageHeader: string,
  pagesHeader: string | null,
  objects: Map<string, ParsedPdfObject>,
  globalColorSpaces: Map<string, string>
) {
  let maps: ResourceMaps = {
    colorSpaceMap: new Map(globalColorSpaces),
    xObjectMap: new Map<string, string>(),
  };

  const indirectRef = pageHeader.match(/\/Resources\s+(\d+)\s+(\d+)\s+R/);
  if (indirectRef) {
    maps = resolveResourcesMaps(`${indirectRef[1]} ${indirectRef[2]} R`, objects, globalColorSpaces);
  } else {
    const inlineDict = pageHeader.match(/\/Resources\s*<<([\s\S]*?)>>\s*(?=\/|$)/)?.[0] ?? "";
    if (inlineDict) {
      maps = resolveResourcesMaps(inlineDict, objects, globalColorSpaces);
    }
  }

  if (pagesHeader) {
    const pagesMaps = resolveResourcesMaps(pagesHeader, objects, globalColorSpaces);
    maps = mergeResourceMaps(pagesMaps, maps);
  }

  return maps;
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
        if (content[index] === "(") depth += 1;
        if (content[index] === ")") depth -= 1;
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
      } else {
        while (index < content.length && content[index] !== ">") {
          index += 1;
        }
        index += 1;
      }
      continue;
    }

    if (char === "[") {
      index += 1;
      let depth = 1;
      while (index < content.length && depth > 0) {
        if (content[index] === "[") depth += 1;
        if (content[index] === "]") depth -= 1;
        index += 1;
      }
      continue;
    }

    if (char === "/") {
      index += 1;
      let name = "/";
      while (index < content.length && !/[\s\[\]()<>]/.test(content[index])) {
        name += content[index];
        index += 1;
      }
      tokens.push(name);
      continue;
    }

    if (char === "-" && index + 1 < content.length && /\d/.test(content[index + 1])) {
      let token = "-";
      index += 1;
      while (index < content.length && /[\d.]/.test(content[index])) {
        token += content[index];
        index += 1;
      }
      tokens.push(token);
      continue;
    }

    let token = "";
    while (index < content.length && !/[\s\[\]()<>/%]/.test(content[index])) {
      token += content[index];
      index += 1;
    }
    if (token) {
      tokens.push(token);
    }
  }

  return tokens;
}

function resolveColorSpaceName(name: string, colorSpaceMap: Map<string, string>) {
  const raw = name.startsWith("/") ? name.slice(1) : name;
  return colorSpaceMap.get(raw) ?? raw;
}

function operandsIncludeTargetSeparation(operands: string[], targetSeparation: string) {
  for (const operand of operands) {
    if (operand.startsWith("/")) {
      const resolved = operand.slice(1);
      if (separationNamesMatch(resolved, targetSeparation)) {
        return true;
      }
    }
  }
  return false;
}

function cloneGraphicsState(state: GraphicsState): GraphicsState {
  return {
    ctm: [...state.ctm] as Matrix,
    strokeColorSpace: state.strokeColorSpace,
    fillColorSpace: state.fillColorSpace,
    strokeUsesTarget: state.strokeUsesTarget,
    fillUsesTarget: state.fillUsesTarget,
  };
}

function applyPathCommand(
  commands: CutPathPathCommand[],
  matrix: Matrix,
  operator: string,
  operands: string[]
) {
  const numbers = operands.map(parseNumber);
  if (numbers.some((value) => value == null)) {
    return;
  }

  const nums = numbers as number[];

  if (operator === "m" && nums.length >= 2) {
    const point = transformPoint(matrix, nums[0], nums[1]);
    commands.push({ op: "M", x: point.x, y: point.y });
    return;
  }

  if (operator === "l" && nums.length >= 2) {
    const point = transformPoint(matrix, nums[0], nums[1]);
    commands.push({ op: "L", x: point.x, y: point.y });
    return;
  }

  if (operator === "c" && nums.length >= 6) {
    const p1 = transformPoint(matrix, nums[0], nums[1]);
    const p2 = transformPoint(matrix, nums[2], nums[3]);
    const p3 = transformPoint(matrix, nums[4], nums[5]);
    commands.push({ op: "C", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p3.x, y: p3.y });
    return;
  }

  if (operator === "v" && nums.length >= 4) {
    const last = commands.at(-1);
    const start =
      last?.op === "M" || last?.op === "L"
        ? { x: last.x, y: last.y }
        : last?.op === "C"
          ? { x: last.x, y: last.y }
          : { x: 0, y: 0 };
    const p2 = transformPoint(matrix, nums[0], nums[1]);
    const p3 = transformPoint(matrix, nums[2], nums[3]);
    commands.push({
      op: "C",
      x1: start.x,
      y1: start.y,
      x2: p2.x,
      y2: p2.y,
      x: p3.x,
      y: p3.y,
    });
    return;
  }

  if (operator === "y" && nums.length >= 4) {
    const p1 = transformPoint(matrix, nums[0], nums[1]);
    const p3 = transformPoint(matrix, nums[2], nums[3]);
    commands.push({ op: "C", x1: p1.x, y1: p1.y, x2: p3.x, y2: p3.y, x: p3.x, y: p3.y });
    return;
  }

  if (operator === "re" && nums.length >= 4) {
    const [x, y, width, height] = nums;
    const corners = [
      transformPoint(matrix, x, y),
      transformPoint(matrix, x + width, y),
      transformPoint(matrix, x + width, y + height),
      transformPoint(matrix, x, y + height),
    ];
    commands.push({ op: "M", x: corners[0].x, y: corners[0].y });
    commands.push({ op: "L", x: corners[1].x, y: corners[1].y });
    commands.push({ op: "L", x: corners[2].x, y: corners[2].y });
    commands.push({ op: "L", x: corners[3].x, y: corners[3].y });
    commands.push({ op: "Z" });
  }
}

function paintModeUsesTarget(operator: string, state: GraphicsState): PaintMode | null {
  const usesStroke = ["S", "s", "B", "B*", "b", "b*"].includes(operator) && state.strokeUsesTarget;
  const usesFill = ["f", "F", "f*", "B", "B*", "b", "b*"].includes(operator) && state.fillUsesTarget;
  if (usesStroke && usesFill) {
    return "both";
  }
  if (usesStroke) {
    return "stroke";
  }
  if (usesFill) {
    return "fill";
  }
  return null;
}

function parseFormMatrix(header: string): Matrix {
  const match = header.match(/\/Matrix\s*\[\s*([^\]]+)\]/);
  if (!match?.[1]) {
    return IDENTITY_MATRIX;
  }

  const values = match[1]
    .trim()
    .split(/\s+/)
    .map(parseNumber)
    .filter((value): value is number => value != null);

  if (values.length !== 6) {
    return IDENTITY_MATRIX;
  }

  return [values[0], values[1], values[2], values[3], values[4], values[5]];
}

function updateTargetFlags(state: GraphicsState, targetSeparation: string) {
  state.strokeUsesTarget = Boolean(
    state.strokeColorSpace && separationNamesMatch(state.strokeColorSpace, targetSeparation)
  );
  state.fillUsesTarget = Boolean(
    state.fillColorSpace && separationNamesMatch(state.fillColorSpace, targetSeparation)
  );
}

function applySeparationOperandsToState(
  state: GraphicsState,
  operator: string,
  operands: string[],
  targetSeparation: string
) {
  if (operandsIncludeTargetSeparation(operands, targetSeparation)) {
    if (operator === "SCN" || operator === "SC") {
      state.strokeUsesTarget = true;
    }
    if (operator === "scn" || operator === "sc") {
      state.fillUsesTarget = true;
    }
  }

  updateTargetFlags(state, targetSeparation);
}

async function interpretContentStream(
  content: string,
  targetSeparation: string,
  resources: ResourceMaps,
  objects: Map<string, ParsedPdfObject>,
  initialMatrix: Matrix,
  collected: CutPathSubpath[],
  counters: InterpretCounters,
  limits: InterpretLimits,
  visitedForms: Set<string>
) {
  if (counters.operatorsProcessed > limits.maxOperators || collected.length >= limits.maxPaths) {
    return;
  }

  const tokens = tokenizeContentStream(content);
  const operands: string[] = [];
  const stateStack: GraphicsState[] = [];
  let state: GraphicsState = {
    ctm: initialMatrix,
    strokeColorSpace: null,
    fillColorSpace: null,
    strokeUsesTarget: false,
    fillUsesTarget: false,
  };
  let currentPath: CutPathPathCommand[] = [];

  for (const token of tokens) {
    counters.operatorsProcessed += 1;
    if (counters.operatorsProcessed > limits.maxOperators || collected.length >= limits.maxPaths) {
      break;
    }

    if (!Number.isNaN(Number.parseFloat(token))) {
      operands.push(token);
      continue;
    }

    if (token.startsWith("/")) {
      operands.push(token);
      continue;
    }

    const operator = token;

    if (operator === "q") {
      stateStack.push(cloneGraphicsState(state));
      operands.length = 0;
      continue;
    }

    if (operator === "Q") {
      state = stateStack.pop() ?? state;
      operands.length = 0;
      continue;
    }

    if (operator === "cm" && operands.length >= 6) {
      const values = operands.slice(-6).map(parseNumber) as number[];
      state.ctm = multiplyMatrix(state.ctm, [
        values[0],
        values[1],
        values[2],
        values[3],
        values[4],
        values[5],
      ]);
      operands.length = 0;
      continue;
    }

    if (operator === "CS" && operands.length >= 1) {
      state.strokeColorSpace = resolveColorSpaceName(operands.at(-1) ?? "", resources.colorSpaceMap);
      updateTargetFlags(state, targetSeparation);
      if (state.strokeUsesTarget) {
        counters.separationOperatorsSeen += 1;
      }
      operands.length = 0;
      continue;
    }

    if (operator === "cs" && operands.length >= 1) {
      state.fillColorSpace = resolveColorSpaceName(operands.at(-1) ?? "", resources.colorSpaceMap);
      updateTargetFlags(state, targetSeparation);
      if (state.fillUsesTarget) {
        counters.separationOperatorsSeen += 1;
      }
      operands.length = 0;
      continue;
    }

    if (["SC", "SCN", "sc", "scn"].includes(operator)) {
      applySeparationOperandsToState(state, operator, operands, targetSeparation);
      if (state.strokeUsesTarget || state.fillUsesTarget) {
        counters.separationOperatorsSeen += 1;
      }
      operands.length = 0;
      continue;
    }

    if (["m", "l", "c", "v", "y", "re"].includes(operator)) {
      applyPathCommand(currentPath, state.ctm, operator, operands);
      operands.length = 0;
      continue;
    }

    if (operator === "h") {
      currentPath.push({ op: "Z" });
      operands.length = 0;
      continue;
    }

    if (PATH_PAINT_OPERATORS.has(operator)) {
      if (paintModeUsesTarget(operator, state) && currentPath.length > 0) {
        collected.push([...currentPath]);
        counters.pathsCollected += 1;
      }
      currentPath = [];
      operands.length = 0;
      continue;
    }

    if (operator === "Do" && operands.length >= 1) {
      const name = operands.at(-1)?.replace(/^\//, "") ?? "";
      const ref = resources.xObjectMap.get(name);
      if (
        ref &&
        counters.formsVisited < limits.maxForms &&
        counters.depth < limits.maxDepth &&
        !visitedForms.has(ref)
      ) {
        visitedForms.add(ref);
        counters.formsVisited += 1;
        counters.depth += 1;

        const object = objects.get(ref);
        if (object?.stream) {
          const nestedContent = decompressStream(object.header, object.stream).toString("latin1");
          const nestedResources = resolveResourcesMaps(object.header, objects, resources.colorSpaceMap);
          const mergedResources = mergeResourceMaps(resources, nestedResources);
          const formMatrix = multiplyMatrix(state.ctm, parseFormMatrix(object.header));

          await interpretContentStream(
            nestedContent,
            targetSeparation,
            mergedResources,
            objects,
            formMatrix,
            collected,
            counters,
            limits,
            visitedForms
          );
        }

        counters.depth -= 1;
      }
      operands.length = 0;
      continue;
    }

    if (operator === "n" || operator === "W" || operator === "W*") {
      currentPath = [];
      operands.length = 0;
      continue;
    }

    operands.length = 0;
  }
}

async function parseObjectStreamForCutPath(
  objectKeyName: string,
  objects: Map<string, ParsedPdfObject>,
  targetSeparation: string,
  resources: ResourceMaps,
  initialMatrix: Matrix,
  collected: CutPathSubpath[],
  counters: InterpretCounters,
  limits: InterpretLimits,
  visitedForms: Set<string>
) {
  const object = objects.get(objectKeyName);
  if (!object?.stream) {
    return;
  }

  const content = decompressStream(object.header, object.stream).toString("latin1");
  await interpretContentStream(
    content,
    targetSeparation,
    resources,
    objects,
    initialMatrix,
    collected,
    counters,
    limits,
    visitedForms
  );
}

async function fallbackScanDecompressedStreams(
  buffer: Buffer,
  objects: Map<string, ParsedPdfObject>,
  targetSeparation: string,
  globalColorSpaces: Map<string, string>,
  collected: CutPathSubpath[],
  counters: InterpretCounters,
  limits: InterpretLimits
) {
  let scanned = 0;
  const targetPattern = new RegExp(normalizeSeparationName(targetSeparation), "i");
  const visitedForms = new Set<string>();
  const seenContent = new Set<string>();

  async function tryStream(header: string, stream: Buffer) {
    const content = decompressStream(header, stream).toString("latin1");
    if (seenContent.has(content)) {
      return;
    }
    seenContent.add(content);

    if (!targetPattern.test(content)) {
      return;
    }

    if (!/(^|\s)(CS|cs|SCN|SC|scn|sc)(\s|$)/.test(content)) {
      return;
    }

    scanned += 1;
    const resources = resolveResourcesMaps(header, objects, globalColorSpaces);
    await interpretContentStream(
      content,
      targetSeparation,
      resources,
      objects,
      IDENTITY_MATRIX,
      collected,
      counters,
      limits,
      visitedForms
    );
  }

  for (const object of objects.values()) {
    if (!object.stream || scanned >= limits.maxForms * 2) {
      continue;
    }
    await tryStream(object.header, object.stream);
    if (collected.length > 0) {
      break;
    }
  }

  if (collected.length === 0) {
    const text = buffer.toString("latin1");
    const streamPattern = /<<([\s\S]{0,400}?\/Length\s+(\d+)[\s\S]{0,200}?)>>\s*stream\r?\n/g;
    let match: RegExpExecArray | null;
    while ((match = streamPattern.exec(text)) !== null && scanned < limits.maxForms * 3) {
      const header = `<<${match[1]}>>`;
      const length = Number.parseInt(match[2], 10);
      const streamStart = match.index + match[0].length;
      if (!Number.isFinite(length) || length <= 0 || streamStart + length > buffer.length) {
        continue;
      }
      await tryStream(header, buffer.subarray(streamStart, streamStart + length));
      if (collected.length > 0) {
        break;
      }
    }
  }

  return scanned;
}

function buildDiagnosticBase(
  separationName: string,
  pageIndex: number,
  resources: ResourceMaps
): CutPathExtractionDiagnostic {
  const colorSpaceAliases: Record<string, string> = {};
  for (const [alias, name] of resources.colorSpaceMap.entries()) {
    colorSpaceAliases[alias] = name;
  }

  return {
    separationName,
    pageIndex,
    pageLocated: false,
    contentStreamCount: 0,
    formXObjectsVisited: 0,
    colorSpaceAliases,
    separationOperatorsSeen: 0,
    paintedPathsFound: 0,
    fallbackStreamsScanned: 0,
    failureStage: "init",
  };
}

export function formatCutPathExtractionFailureReason(diagnostic: CutPathExtractionDiagnostic) {
  if (diagnostic.paintedPathsFound > 0) {
    return null;
  }

  if (!diagnostic.pageLocated) {
    return "CutContour separation detected, but the PDF page structure could not be resolved for vector extraction.";
  }

  if (diagnostic.contentStreamCount === 0) {
    return "CutContour separation detected, but no page content streams could be located.";
  }

  const aliasValues = Object.values(diagnostic.colorSpaceAliases);
  const hasSeparationAlias = aliasValues.some((name) =>
    separationNamesMatch(name, diagnostic.separationName)
  );

  if (!hasSeparationAlias && diagnostic.separationOperatorsSeen === 0) {
    return "CutContour separation detected, but no color-space alias for CutContour was resolved in page or Form resources.";
  }

  if (diagnostic.separationOperatorsSeen === 0) {
    return "CutContour separation detected, but no painted vector paths using that separation could be resolved.";
  }

  if (diagnostic.paintedPathsFound === 0) {
    return "CutContour separation operators were found, but no stroke/fill path geometry could be reconstructed.";
  }

  return "CutContour separation detected, but no painted vector paths using that separation could be resolved.";
}

export async function extractCutPathGeometry(
  buffer: Buffer,
  separationName: string,
  pageIndex = 0,
  options?: { debugLabel?: string }
): Promise<CutPathExtractionResult> {
  const limits = DEFAULT_LIMITS;

  if (!buffer.length) {
    const diagnostic = buildDiagnosticBase(separationName, pageIndex, {
      colorSpaceMap: new Map(),
      xObjectMap: new Map(),
    });
    diagnostic.failureStage = "empty_buffer";
    return { ok: false, reason: "Empty artwork buffer.", diagnostic };
  }

  if (!buffer.subarray(0, 5).toString("ascii").startsWith("%PDF")) {
    const diagnostic = buildDiagnosticBase(separationName, pageIndex, {
      colorSpaceMap: new Map(),
      xObjectMap: new Map(),
    });
    diagnostic.failureStage = "not_pdf";
    return { ok: false, reason: "Artwork is not a PDF.", diagnostic };
  }

  let mediaBox = { x: 0, y: 0, width: 0, height: 0 };
  let rotation = 0;

  try {
    const document = await PDFDocument.load(buffer, { ignoreEncryption: true });
    if (document.getPageCount() <= pageIndex) {
      const diagnostic = buildDiagnosticBase(separationName, pageIndex, {
        colorSpaceMap: new Map(),
        xObjectMap: new Map(),
      });
      diagnostic.failureStage = "missing_page";
      return { ok: false, reason: "PDF does not contain a renderable page.", diagnostic };
    }

    const page = document.getPage(pageIndex);
    const size = page.getSize();
    const box = page.getMediaBox();
    mediaBox = { x: box.x, y: box.y, width: size.width, height: size.height };
    rotation = page.getRotation().angle;
  } catch {
    const diagnostic = buildDiagnosticBase(separationName, pageIndex, {
      colorSpaceMap: new Map(),
      xObjectMap: new Map(),
    });
    diagnostic.failureStage = "page_metrics";
    return { ok: false, reason: "Unable to read PDF page dimensions.", diagnostic };
  }

  const objects = parsePdfObjects(buffer);
  const globalColorSpaces = buildGlobalColorSpaceRegistry(objects);
  globalColorSpaces.set(separationName, separationName);

  const pages = findPageObjectHeaders(buffer);
  const pageHeader = pages[pageIndex];
  const pagesHeader = findPagesObjectHeader(buffer);

  const resources = pageHeader
    ? resolvePageResources(pageHeader, pagesHeader, objects, globalColorSpaces)
    : { colorSpaceMap: globalColorSpaces, xObjectMap: new Map<string, string>() };

  const diagnostic = buildDiagnosticBase(separationName, pageIndex, resources);
  diagnostic.pageLocated = Boolean(pageHeader);

  if (!pageHeader) {
    diagnostic.failureStage = "page_header";
    return {
      ok: false,
      reason: "Unable to locate PDF page content.",
      diagnostic,
    };
  }

  const contents = resolveContentsReferences(pageHeader);
  diagnostic.contentStreamCount = contents.length;
  const collected: CutPathSubpath[] = [];
  const counters: InterpretCounters = {
    depth: 0,
    formsVisited: 0,
    pathsCollected: 0,
    operatorsProcessed: 0,
    separationOperatorsSeen: 0,
  };
  const visitedForms = new Set<string>();

  for (const contentRef of contents) {
    await parseObjectStreamForCutPath(
      contentRef,
      objects,
      separationName,
      resources,
      IDENTITY_MATRIX,
      collected,
      counters,
      limits,
      visitedForms
    );
  }

  if (collected.length === 0) {
    diagnostic.failureStage = "page_streams_empty";
    diagnostic.fallbackStreamsScanned = await fallbackScanDecompressedStreams(
      buffer,
      objects,
      separationName,
      globalColorSpaces,
      collected,
      counters,
      limits
    );
  }

  diagnostic.formXObjectsVisited = counters.formsVisited;
  diagnostic.separationOperatorsSeen = counters.separationOperatorsSeen;
  diagnostic.paintedPathsFound = collected.length;

  logProofGeneratorDebug("cut_path_geometry_extract", {
    debugLabel: options?.debugLabel ?? null,
    ...diagnostic,
  });

  if (collected.length === 0) {
    diagnostic.failureStage = diagnostic.fallbackStreamsScanned
      ? "fallback_streams_empty"
      : diagnostic.failureStage;
    const reason =
      formatCutPathExtractionFailureReason(diagnostic) ??
      `No vector geometry found for separation ${separationName}.`;
    return { ok: false, reason, diagnostic };
  }

  return {
    ok: true,
    geometry: {
      subpaths: collected,
      pageIndex,
      mediaBox,
      rotation,
    },
    diagnostic,
  };
}

export function cutPathGeometryHasContent(geometry: CutPathGeometry) {
  return geometry.subpaths.some((subpath) => subpath.length > 0);
}
