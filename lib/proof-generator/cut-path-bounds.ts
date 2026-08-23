import { PT_TO_MM } from "@/lib/proof-generator/constants";
import type {
  CutPathGeometry,
  CutPathSubpath,
} from "@/lib/proof-generator/extract-cut-path-geometry";
import type {
  CutPathContourBounds,
  CutPathShapeKind,
  PdfBoxDimensions,
} from "@/lib/proof-generator/types";

export type { CutPathContourBounds, CutPathShapeKind } from "@/lib/proof-generator/types";

export type CutPathBoundsResult = {
  widthPt: number;
  heightPt: number;
  widthMm: number;
  heightMm: number;
  minXPt: number;
  minYPt: number;
  maxXPt: number;
  maxYPt: number;
  contours: CutPathContourBounds[];
  overallShape: CutPathShapeKind;
};

type Point = { x: number; y: number };

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

function expandBounds(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  x: number,
  y: number
) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

/** Solve quadratic at² + bt + c = 0 for roots in [0, 1]. */
function quadraticRootsInUnitInterval(a: number, b: number, c: number): number[] {
  const roots: number[] = [];

  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -c / b;
      if (t >= 0 && t <= 1) {
        roots.push(t);
      }
    }
    return roots;
  }

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return roots;
  }

  const sqrt = Math.sqrt(discriminant);
  for (const t of [(-b - sqrt) / (2 * a), (-b + sqrt) / (2 * a)]) {
    if (t >= 0 && t <= 1) {
      roots.push(t);
    }
  }

  return roots;
}

/** True geometric bounds of a cubic Bezier segment. */
export function computeCubicBezierBounds(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point
): { minX: number; minY: number; maxX: number; maxY: number } {
  const bounds = {
    minX: Math.min(p0.x, p3.x),
    minY: Math.min(p0.y, p3.y),
    maxX: Math.max(p0.x, p3.x),
    maxY: Math.max(p0.y, p3.y),
  };

  const evaluate = (t: number) => {
    const mt = 1 - t;
    return {
      x:
        mt * mt * mt * p0.x +
        3 * mt * mt * t * p1.x +
        3 * mt * t * t * p2.x +
        t * t * t * p3.x,
      y:
        mt * mt * mt * p0.y +
        3 * mt * mt * t * p1.y +
        3 * mt * t * t * p2.y +
        t * t * t * p3.y,
    };
  };

  const tCandidates = new Set<number>([0, 1]);

  for (const [a, b, c, d] of [
    [p0.x, p1.x, p2.x, p3.x],
    [p0.y, p1.y, p2.y, p3.y],
  ] as const) {
    const A = 3 * (-a + 3 * b - 3 * c + d);
    const B = 6 * (a - 2 * b + c);
    const C = 3 * (-a + b);
    for (const t of quadraticRootsInUnitInterval(A, B, C)) {
      tCandidates.add(t);
    }
  }

  for (const t of tCandidates) {
    const point = evaluate(t);
    expandBounds(bounds, point.x, point.y);
  }

  return bounds;
}

function computeSubpathBounds(subpath: CutPathSubpath): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (!subpath.length) {
    return null;
  }

  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  let current: Point | null = null;
  let subpathStart: Point | null = null;

  for (const command of subpath) {
    if (command.op === "M") {
      current = { x: command.x, y: command.y };
      subpathStart = current;
      expandBounds(bounds, command.x, command.y);
      continue;
    }

    if (!current) {
      continue;
    }

    if (command.op === "L") {
      expandBounds(bounds, command.x, command.y);
      current = { x: command.x, y: command.y };
      continue;
    }

    if (command.op === "C") {
      const p0 = current;
      const p1 = { x: command.x1, y: command.y1 };
      const p2 = { x: command.x2, y: command.y2 };
      const p3 = { x: command.x, y: command.y };
      const curveBounds = computeCubicBezierBounds(p0, p1, p2, p3);
      expandBounds(bounds, curveBounds.minX, curveBounds.minY);
      expandBounds(bounds, curveBounds.maxX, curveBounds.maxY);
      current = p3;
      continue;
    }

    if (command.op === "Z" && subpathStart) {
      current = subpathStart;
    }
  }

  if (!Number.isFinite(bounds.minX)) {
    return null;
  }

  return bounds;
}

function classifySubpathShape(
  subpath: CutPathSubpath,
  widthPt: number,
  heightPt: number
): CutPathShapeKind {
  const commands = subpath.filter((command) => command.op !== "Z");
  const cubicCount = commands.filter((command) => command.op === "C").length;
  const lineCount = commands.filter((command) => command.op === "L").length;
  const moveCount = commands.filter((command) => command.op === "M").length;

  const aspect = widthPt > 0 && heightPt > 0 ? widthPt / heightPt : 1;
  const nearlySquare = aspect >= 0.95 && aspect <= 1.05;

  if (moveCount === 1 && lineCount === 3 && cubicCount === 0 && nearlySquare) {
    return "rectangle";
  }

  if (moveCount === 1 && lineCount === 0 && cubicCount === 4 && nearlySquare) {
    return "circle";
  }

  if (moveCount === 1 && lineCount === 0 && cubicCount === 0 && nearlySquare) {
    return "rectangle";
  }

  return "custom_contour";
}

export function computeCutPathBounds(geometry: CutPathGeometry): CutPathBoundsResult | null {
  const contours: CutPathContourBounds[] = [];

  for (let index = 0; index < geometry.subpaths.length; index += 1) {
    const subpath = geometry.subpaths[index];
    const bounds = computeSubpathBounds(subpath);
    if (!bounds) {
      continue;
    }

    const widthPt = bounds.maxX - bounds.minX;
    const heightPt = bounds.maxY - bounds.minY;
    if (widthPt <= 0 || heightPt <= 0) {
      continue;
    }

    contours.push({
      index,
      widthPt: Math.round(widthPt * 100) / 100,
      heightPt: Math.round(heightPt * 100) / 100,
      widthMm: pointsToMm(widthPt),
      heightMm: pointsToMm(heightPt),
      minXPt: Math.round(bounds.minX * 100) / 100,
      minYPt: Math.round(bounds.minY * 100) / 100,
      maxXPt: Math.round(bounds.maxX * 100) / 100,
      maxYPt: Math.round(bounds.maxY * 100) / 100,
      shape: classifySubpathShape(subpath, widthPt, heightPt),
    });
  }

  if (!contours.length) {
    return null;
  }

  const minXPt = Math.min(...contours.map((contour) => contour.minXPt));
  const minYPt = Math.min(...contours.map((contour) => contour.minYPt));
  const maxXPt = Math.max(...contours.map((contour) => contour.maxXPt));
  const maxYPt = Math.max(...contours.map((contour) => contour.maxYPt));
  const widthPt = maxXPt - minXPt;
  const heightPt = maxYPt - minYPt;

  const shapeCounts = contours.reduce(
    (counts, contour) => {
      counts[contour.shape] += 1;
      return counts;
    },
    { circle: 0, rectangle: 0, custom_contour: 0 }
  );

  let overallShape: CutPathShapeKind = "custom_contour";
  if (contours.length === 1) {
    overallShape = contours[0].shape;
  } else if (shapeCounts.rectangle === contours.length) {
    overallShape = "rectangle";
  } else if (shapeCounts.circle === contours.length) {
    overallShape = "circle";
  }

  return {
    widthPt: Math.round(widthPt * 100) / 100,
    heightPt: Math.round(heightPt * 100) / 100,
    widthMm: pointsToMm(widthPt),
    heightMm: pointsToMm(heightPt),
    minXPt: Math.round(minXPt * 100) / 100,
    minYPt: Math.round(minYPt * 100) / 100,
    maxXPt: Math.round(maxXPt * 100) / 100,
    maxYPt: Math.round(maxYPt * 100) / 100,
    contours,
    overallShape,
  };
}

export function cutPathBoundsToDimensions(bounds: CutPathBoundsResult): PdfBoxDimensions {
  return dimensionsFromPoints(bounds.widthPt, bounds.heightPt);
}

export function formatCutPathShapeLabel(shape: CutPathShapeKind | null | undefined) {
  switch (shape) {
    case "circle":
      return "Circle";
    case "rectangle":
      return "Rectangle";
    case "custom_contour":
      return "Custom contour";
    default:
      return null;
  }
}
