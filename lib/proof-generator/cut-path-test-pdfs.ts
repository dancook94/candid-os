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
