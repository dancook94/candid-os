import { deflateSync } from "node:zlib";

type CutPathShape = "circle" | "rectangle" | "irregular";

function buildSeparationObject(separationName: string) {
  return `5 0 obj[/Separation/${separationName}/DeviceCMYK 6 0 R]endobj`;
}

function buildTintFunctionObject() {
  return "6 0 obj<</FunctionType 2/Domain[0 1]/Range[0 1 0 1 0 1 0]/C0[0 0 0 0]/C1[0 1 0 0]>>endobj";
}

function buildPathStream(shape: CutPathShape) {
  switch (shape) {
    case "rectangle":
      return "q /CutContour CS 1 SC 50 50 100 100 re S Q";
    case "circle":
      return [
        "q",
        "/CutContour CS 1 SC",
        "150 200 m",
        "200 150 200 100 150 100 c",
        "100 150 100 200 150 200 c",
        "h S",
        "Q",
      ].join(" ");
    case "irregular":
      return [
        "q",
        "/CutContour CS 1 SC",
        "40 40 m",
        "180 60 l",
        "160 180 l",
        "70 150 l",
        "40 90 l",
        "h S",
        "Q",
      ].join(" ");
  }
}

export function buildCutPathTestPdfBuffer(input: {
  shape: CutPathShape;
  pageSize?: [number, number];
  includeCutPath?: boolean;
  separationName?: string;
  compress?: boolean;
}) {
  const pageWidth = input.pageSize?.[0] ?? 200;
  const pageHeight = input.pageSize?.[1] ?? 200;
  const separationName = input.separationName ?? "CutContour";
  const includeCutPath = input.includeCutPath ?? true;
  const artworkStream = "q 0.9 0.9 0.9 rg 0 0 200 200 re f Q";
  const cutPathStream = includeCutPath ? buildPathStream(input.shape) : "";
  const contentStream = `${artworkStream}\n${cutPathStream}`.trim();
  const streamBytes = Buffer.from(contentStream, "latin1");
  const compressed = input.compress ? deflateSync(streamBytes) : streamBytes;
  const length = compressed.length;
  const filter = input.compress ? "/Filter/FlateDecode" : "";

  const prefix = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pageWidth} ${pageHeight}]/Contents 4 0 R/Resources<</ColorSpace<</CutContour 5 0 R>>>>>>endobj`,
    `4 0 obj<</Length ${length}${filter}>>stream\n`,
  ].join("\n");

  const suffix = [
    "endstream",
    "endobj",
    buildSeparationObject(separationName),
    buildTintFunctionObject(),
    "trailer<</Size 7/Root 1 0 R>>",
    "%%EOF",
  ].join("\n");

  return Buffer.concat([
    Buffer.from(prefix, "latin1"),
    compressed,
    Buffer.from(`\n${suffix}`, "latin1"),
  ]);
}

/** Illustrator-like PDF: cut path lives inside a Form XObject, page only invokes /Fm0 Do */
export function buildIllustratorFormXObjectCutPathPdfBuffer(input?: {
  shape?: CutPathShape;
  compress?: boolean;
}) {
  const shape = input?.shape ?? "rectangle";
  const compress = input?.compress ?? true;
  const cutPathStream = buildPathStream(shape).replace(/\/CutContour/g, "/Cs0");
  const formStream = `q ${cutPathStream} Q`;
  const formBytes = Buffer.from(formStream, "latin1");
  const compressedForm = compress ? deflateSync(formBytes) : formBytes;
  const pageStream = "q 1 0 0 1 0 0 cm /Fm0 Do Q";
  const pageBytes = Buffer.from(pageStream, "latin1");
  const compressedPage = compress ? deflateSync(pageBytes) : pageBytes;

  const parts = [
    "%PDF-1.5",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "7 0 obj<</ColorSpace<</Cs0 5 0 R>>/XObject<</Fm0 8 0 R>>>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources 7 0 R/Contents 4 0 R>>endobj",
    `4 0 obj<</Length ${compressedPage.length}${compress ? "/Filter/FlateDecode" : ""}>>stream\n`,
  ].join("\n");

  return Buffer.concat([
    Buffer.from(parts, "latin1"),
    compressedPage,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
    Buffer.from(
      `5 0 obj[/Separation/CutContour/DeviceCMYK 6 0 R]endobj\n${buildTintFunctionObject()}\n`,
      "latin1"
    ),
    Buffer.from(
      `8 0 obj<</Subtype/Form/FormType 1/BoundingBox[0 0 200 200]/Matrix[1 0 0 1 0 0]/Resources<</ColorSpace<</Cs0 5 0 R>>>>/Length ${compressedForm.length}${compress ? "/Filter/FlateDecode" : ""}>>stream\n`,
      "latin1"
    ),
    compressedForm,
    Buffer.from("\nendstream\nendobj\ntrailer<</Size 9/Root 1 0 R>>\n%%EOF\n", "latin1"),
  ]);
}

/** Illustrator-like PDF: inline Separation array in page Resources */
export function buildIllustratorInlineSeparationCutPathPdfBuffer(input?: { shape?: CutPathShape }) {
  const shape = input?.shape ?? "circle";
  const cutPathStream = buildPathStream(shape).replace(/\/CutContour/g, "/Cs0").replace(/1 SC/g, "1 SCN");
  const streamBytes = Buffer.from(`q 0.9 0.9 0.9 rg 0 0 200 200 re f ${cutPathStream} Q`, "latin1");

  const prefix = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</ColorSpace<</Cs0[/Separation/CutContour/DeviceCMYK 6 0 R]>>>>>>endobj",
    `4 0 obj<</Length ${streamBytes.length}>>stream\n`,
  ].join("\n");

  return Buffer.concat([
    Buffer.from(prefix, "latin1"),
    streamBytes,
    Buffer.from(`\nendstream\nendobj\n${buildSeparationObject("CutContour")}\n${buildTintFunctionObject()}\ntrailer<</Size 7/Root 1 0 R>>\n%%EOF\n`, "latin1"),
  ]);
}

/** PDF where cut path lives in a CutContour Optional Content Group (BDC/EMC), not Separation. */
export function buildOcgCutPathPdfBuffer(input?: {
  shape?: CutPathShape;
  compress?: boolean;
}) {
  const shape = input?.shape ?? "rectangle";
  const compress = input?.compress ?? false;
  const pathOps =
    shape === "rectangle"
      ? "50 50 100 100 re S"
      : shape === "circle"
        ? "150 200 m 200 150 200 100 150 100 c 100 150 100 200 150 200 c h S"
        : "40 40 m 180 60 l 160 180 l 70 150 l 40 90 l h S";
  const contentStream = `q /OC /MC0 BDC q ${pathOps} Q EMC Q`;
  const streamBytes = Buffer.from(contentStream, "latin1");
  const compressed = compress ? deflateSync(streamBytes) : streamBytes;
  const length = compressed.length;
  const filter = compress ? "/Filter/FlateDecode" : "";

  const prefix = [
    "%PDF-1.5",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "5 0 obj<</Type/OCG/Name(CutContour)>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Properties<</MC0 5 0 R>>>>>>endobj",
    `4 0 obj<</Length ${length}${filter}>>stream\n`,
  ].join("\n");

  const suffix = ["endstream", "endobj", "trailer<</Size 6/Root 1 0 R>>", "%%EOF"].join("\n");

  return Buffer.concat([
    Buffer.from(prefix, "latin1"),
    compressed,
    Buffer.from(`\n${suffix}`, "latin1"),
  ]);
}

/** CutContour OCG path inside a Form XObject; page invokes /Fm0 Do */
export function buildOcgFormXObjectCutPathPdfBuffer(input?: { shape?: CutPathShape }) {
  const shape = input?.shape ?? "rectangle";
  const pathOps =
    shape === "rectangle"
      ? "50 50 100 100 re S"
      : "40 40 m 180 60 l 160 180 l 70 150 l 40 90 l h S";
  const formStream = `q /OC /MC0 BDC q ${pathOps} Q EMC Q`;
  const formBytes = Buffer.from(formStream, "latin1");
  const compressedForm = deflateSync(formBytes);
  const pageStream = "q 1 0 0 1 0 0 cm /Fm0 Do Q";
  const pageBytes = Buffer.from(pageStream, "latin1");
  const compressedPage = deflateSync(pageBytes);

  return Buffer.concat([
    Buffer.from(
      [
        "%PDF-1.5",
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
        "5 0 obj<</Type/OCG/Name(CutContour)>>endobj",
        "7 0 obj<</Properties<</MC0 5 0 R>>/XObject<</Fm0 8 0 R>>>>endobj",
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources 7 0 R/Contents 4 0 R>>endobj",
        `4 0 obj<</Length ${compressedPage.length}/Filter/FlateDecode>>stream\n`,
      ].join("\n"),
      "latin1"
    ),
    compressedPage,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
    Buffer.from(
      `8 0 obj<</Subtype/Form/FormType 1/BoundingBox[0 0 200 200]/Matrix[1 0 0 1 0 0]/Resources<</Properties<</MC0 5 0 R>>>>/Length ${compressedForm.length}/Filter/FlateDecode>>stream\n`,
      "latin1"
    ),
    compressedForm,
    Buffer.from("\nendstream\nendobj\ntrailer<</Size 9/Root 1 0 R>>\n%%EOF\n", "latin1"),
  ]);
}

/** Illustrator-like PDF: nested Form XObjects */
export function buildIllustratorNestedFormCutPathPdfBuffer() {
  const inner = "q /Cs0 CS 1 SC 60 60 80 80 re S Q";
  const innerBytes = Buffer.from(inner, "latin1");
  const innerCompressed = deflateSync(innerBytes);
  const outer = "q 1 0 0 1 0 0 cm /Inner Do Q";
  const outerBytes = Buffer.from(outer, "latin1");
  const outerCompressed = deflateSync(outerBytes);
  const page = "q /Outer Do Q";
  const pageBytes = Buffer.from(page, "latin1");
  const pageCompressed = deflateSync(pageBytes);

  return Buffer.concat([
    Buffer.from(
      [
        "%PDF-1.5",
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<</XObject<</Outer 8 0 R>>>>/Contents 4 0 R>>endobj",
        `4 0 obj<</Length ${pageCompressed.length}/Filter/FlateDecode>>stream\n`,
      ].join("\n"),
      "latin1"
    ),
    pageCompressed,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
    Buffer.from(`${buildSeparationObject("CutContour")}\n${buildTintFunctionObject()}\n`, "latin1"),
    Buffer.from(
      `8 0 obj<</Subtype/Form/FormType 1/BoundingBox[0 0 200 200]/Resources<</ColorSpace<</Cs0 5 0 R>>/XObject<</Inner 9 0 R>>>>/Length ${outerCompressed.length}/Filter/FlateDecode>>stream\n`,
      "latin1"
    ),
    outerCompressed,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
    Buffer.from(
      `9 0 obj<</Subtype/Form/FormType 1/BoundingBox[0 0 200 200]/Resources<</ColorSpace<</Cs0 5 0 R>>>/Length ${innerCompressed.length}/Filter/FlateDecode>>stream\n`,
      "latin1"
    ),
    innerCompressed,
    Buffer.from("\nendstream\nendobj\ntrailer<</Size 10/Root 1 0 R>>\n%%EOF\n", "latin1"),
  ]);
}
