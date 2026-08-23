import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

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

export type CutPathExtractionResult =
  | { ok: true; geometry: CutPathGeometry }
  | { ok: false; reason: string };

type Matrix = [number, number, number, number, number, number];

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

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

const PATH_PAINT_OPERATORS = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"]);

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
  return name.trim().toLowerCase();
}

function separationNamesMatch(left: string, right: string) {
  return normalizeSeparationName(left) === normalizeSeparationName(right);
}

function parseNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePdfObjects(buffer: Buffer): Map<string, ParsedPdfObject> {
  const text = buffer.toString("latin1");
  const objects = new Map<string, ParsedPdfObject>();
  const pattern = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const objectNumber = Number.parseInt(match[1], 10);
    const generation = Number.parseInt(match[2], 10);
    const body = match[3];
    const streamIndex = body.indexOf("stream");
    let header = body;
    let stream: Buffer | null = null;

    if (streamIndex >= 0) {
      header = body.slice(0, streamIndex);
      const streamStart = streamIndex + "stream".length;
      let contentStart = streamStart;
      if (body[contentStart] === "\r" && body[contentStart + 1] === "\n") {
        contentStart += 2;
      } else if (body[contentStart] === "\n") {
        contentStart += 1;
      }

      const endStreamIndex = body.indexOf("endstream", contentStart);
      if (endStreamIndex >= 0) {
        stream = Buffer.from(body.slice(contentStart, endStreamIndex), "latin1");
      }
    }

    objects.set(`${objectNumber} ${generation}`, {
      objectNumber,
      generation,
      header,
      stream,
    });
  }

  return objects;
}

function decompressStream(header: string, stream: Buffer): Buffer {
  if (/\/Filter\s*\/FlateDecode\b/.test(header) || /\/Filter\s*\[\s*\/FlateDecode/.test(header)) {
    try {
      return inflateSync(stream);
    } catch {
      return stream;
    }
  }

  return stream;
}

function parseColorSpaceSeparationName(header: string): string | null {
  const separationMatch = header.match(
    /\[?\s*\/Separation\s*\/([A-Za-z0-9_+-]+)/i
  );
  if (separationMatch?.[1]) {
    return separationMatch[1];
  }

  const arrayMatch = header.match(/\/Separation\s*\/([A-Za-z0-9_+-]+)/i);
  return arrayMatch?.[1] ?? null;
}

function buildColorSpaceMap(resourcesHeader: string, objects: Map<string, ParsedPdfObject>) {
  const map = new Map<string, string>();
  const colorSpaceBlock = resourcesHeader.match(/\/ColorSpace\s*<<([\s\S]*?)>>/);
  if (!colorSpaceBlock?.[1]) {
    return map;
  }

  const entries = colorSpaceBlock[1].matchAll(/\/([A-Za-z0-9_+-]+)\s+(\d+\s+\d+\s+R|\/[^\s]+|\[[^\]]+\])/g);
  for (const entry of entries) {
    const resourceName = entry[1];
    const target = entry[2].trim();

    if (target.startsWith("/")) {
      map.set(resourceName, target.slice(1));
      continue;
    }

    const refKey = target.replace(/\s+R$/, " 0");
    const object = objects.get(refKey);
    if (!object) {
      continue;
    }

    const separationName = parseColorSpaceSeparationName(object.header);
    if (separationName) {
      map.set(resourceName, separationName);
    }
  }

  return map;
}

function buildXObjectMap(resourcesHeader: string) {
  const map = new Map<string, string>();
  const xObjectBlock = resourcesHeader.match(/\/XObject\s*<<([\s\S]*?)>>/);
  if (!xObjectBlock?.[1]) {
    return map;
  }

  const entries = xObjectBlock[1].matchAll(/\/([A-Za-z0-9_+-]+)\s+(\d+\s+\d+\s+R)/g);
  for (const entry of entries) {
    map.set(entry[1], entry[2].replace(/\s+R$/, " 0"));
  }

  return map;
}

function findPageObjects(buffer: Buffer): string[] {
  const text = buffer.toString("latin1");
  const pageHeaders: string[] = [];
  const pattern = /(\d+\s+\d+\s+obj[\s\S]*?\/Type\s*\/Page(?!\s*s)[\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    pageHeaders.push(match[1]);
  }

  return pageHeaders;
}

function resolveContentsReferences(pageHeader: string): string[] {
  const arrayMatch = pageHeader.match(/\/Contents\s*\[([^\]]+)\]/);
  if (arrayMatch?.[1]) {
    return [...arrayMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((entry) => `${entry[1]} 0`);
  }

  const singleMatch = pageHeader.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
  if (singleMatch?.[1]) {
    return [`${singleMatch[1]} 0`];
  }

  return [];
}

function resolveResourcesHeader(pageHeader: string, objects: Map<string, ParsedPdfObject>) {
  const inlineMatch = pageHeader.match(/\/Resources\s*<<([\s\S]*?)>>/);
  if (inlineMatch?.[0]) {
    return inlineMatch[0];
  }

  const refMatch = pageHeader.match(/\/Resources\s+(\d+)\s+\d+\s+R/);
  if (!refMatch?.[1]) {
    return "";
  }

  const object = objects.get(`${refMatch[1]} 0`);
  return object?.header ?? "";
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
        } else if (content[index] === ")") {
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
  if (name.startsWith("/")) {
    const key = name.slice(1);
    return colorSpaceMap.get(key) ?? key;
  }
  return colorSpaceMap.get(name) ?? name;
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

function pathUsesTarget(operator: string, state: GraphicsState) {
  if (["S", "s", "B", "B*", "b", "b*"].includes(operator)) {
    return state.strokeUsesTarget;
  }
  if (["f", "F", "f*", "B", "B*", "b", "b*"].includes(operator)) {
    return state.fillUsesTarget;
  }
  return false;
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

async function interpretContentStream(
  content: string,
  targetSeparation: string,
  colorSpaceMap: Map<string, string>,
  xObjectMap: Map<string, string>,
  objects: Map<string, ParsedPdfObject>,
  initialMatrix: Matrix,
  collected: CutPathSubpath[]
) {
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

  function updateTargetFlags(current: GraphicsState) {
    current.strokeUsesTarget = Boolean(
      current.strokeColorSpace &&
        separationNamesMatch(current.strokeColorSpace, targetSeparation)
    );
    current.fillUsesTarget = Boolean(
      current.fillColorSpace &&
        separationNamesMatch(current.fillColorSpace, targetSeparation)
    );
  }

  for (const token of tokens) {
    if (!Number.isNaN(Number.parseFloat(token)) || token === "-") {
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
      state.strokeColorSpace = resolveColorSpaceName(operands.at(-1) ?? "", colorSpaceMap);
      updateTargetFlags(state);
      operands.length = 0;
      continue;
    }

    if (operator === "cs" && operands.length >= 1) {
      state.fillColorSpace = resolveColorSpaceName(operands.at(-1) ?? "", colorSpaceMap);
      updateTargetFlags(state);
      operands.length = 0;
      continue;
    }

    if (["SC", "SCN", "sc", "scn"].includes(operator)) {
      updateTargetFlags(state);
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
      if (pathUsesTarget(operator, state) && currentPath.length > 0) {
        collected.push([...currentPath]);
      }
      currentPath = [];
      operands.length = 0;
      continue;
    }

    if (operator === "Do" && operands.length >= 1) {
      const name = operands.at(-1)?.replace(/^\//, "") ?? "";
      const ref = xObjectMap.get(name);
      if (ref) {
        const object = objects.get(ref);
        if (object?.stream) {
          const nestedContent = decompressStream(object.header, object.stream).toString("latin1");
          const nestedResources = object.header.match(/\/Resources\s*<<([\s\S]*?)>>/)?.[0] ?? "";
          const nestedColorSpaces = new Map(colorSpaceMap);
          for (const [key, value] of buildColorSpaceMap(nestedResources, objects)) {
            nestedColorSpaces.set(key, value);
          }
          const nestedXObjects = new Map(xObjectMap);
          for (const [key, value] of buildXObjectMap(nestedResources)) {
            nestedXObjects.set(key, value);
          }
          const formMatrix = multiplyMatrix(state.ctm, parseFormMatrix(object.header));
          await interpretContentStream(
            nestedContent,
            targetSeparation,
            nestedColorSpaces,
            nestedXObjects,
            objects,
            formMatrix,
            collected
          );
        }
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
  objectKey: string,
  objects: Map<string, ParsedPdfObject>,
  targetSeparation: string,
  colorSpaceMap: Map<string, string>,
  xObjectMap: Map<string, string>,
  initialMatrix: Matrix,
  collected: CutPathSubpath[]
) {
  const object = objects.get(objectKey);
  if (!object?.stream) {
    return;
  }

  const content = decompressStream(object.header, object.stream).toString("latin1");
  await interpretContentStream(
    content,
    targetSeparation,
    colorSpaceMap,
    xObjectMap,
    objects,
    initialMatrix,
    collected
  );
}

export async function extractCutPathGeometry(
  buffer: Buffer,
  separationName: string,
  pageIndex = 0
): Promise<CutPathExtractionResult> {
  if (!buffer.length) {
    return { ok: false, reason: "Empty artwork buffer." };
  }

  const header = buffer.subarray(0, 8).toString("ascii");
  if (!header.startsWith("%PDF")) {
    return { ok: false, reason: "Artwork is not a PDF." };
  }

  let mediaBox = { x: 0, y: 0, width: 0, height: 0 };
  let rotation = 0;

  try {
    const document = await PDFDocument.load(buffer, { ignoreEncryption: true });
    if (document.getPageCount() <= pageIndex) {
      return { ok: false, reason: "PDF does not contain a renderable page." };
    }

    const page = document.getPage(pageIndex);
    const size = page.getSize();
    const box = page.getMediaBox();
    mediaBox = {
      x: box.x,
      y: box.y,
      width: size.width,
      height: size.height,
    };
    rotation = page.getRotation().angle;
  } catch {
    return { ok: false, reason: "Unable to read PDF page dimensions." };
  }

  const objects = parsePdfObjects(buffer);
  const pages = findPageObjects(buffer);
  const pageHeader = pages[pageIndex];
  if (!pageHeader) {
    return { ok: false, reason: "Unable to locate PDF page content." };
  }

  const resourcesHeader = resolveResourcesHeader(pageHeader, objects);
  const colorSpaceMap = buildColorSpaceMap(resourcesHeader, objects);
  colorSpaceMap.set(separationName, separationName);
  const xObjectMap = buildXObjectMap(resourcesHeader);
  const contents = resolveContentsReferences(pageHeader);
  const collected: CutPathSubpath[] = [];

  for (const contentRef of contents) {
    await parseObjectStreamForCutPath(
      contentRef,
      objects,
      separationName,
      colorSpaceMap,
      xObjectMap,
      IDENTITY_MATRIX,
      collected
    );
  }

  if (collected.length === 0) {
    return {
      ok: false,
      reason: `No vector geometry found for separation ${separationName}.`,
    };
  }

  return {
    ok: true,
    geometry: {
      subpaths: collected,
      pageIndex,
      mediaBox,
      rotation,
    },
  };
}

export function cutPathGeometryHasContent(geometry: CutPathGeometry) {
  return geometry.subpaths.some((subpath) => subpath.length > 0);
}
