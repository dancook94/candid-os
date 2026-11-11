import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";

import { extractPdfText } from "@/lib/materials/invoices/extract";
import { buildInstallationCompletionReportPdf, type CompletionReportPdfInput } from "@/lib/installations/completion-report-pdf";
import {
  assertReportPhotographCount,
  detectReportImageKind,
  orientedPixelSize,
  placeOrientedPhotograph,
  prepareReportPhotograph,
  readReportImageOrientation,
  unsupportedReportPhotographMessage,
} from "@/lib/installations/report-image";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test("report images recognise every accepted upload format", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ]);
  const heic = new Uint8Array(16);
  heic.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0);

  assert.equal(detectReportImageKind(jpeg), "jpeg");
  assert.equal(detectReportImageKind(png), "png");
  assert.equal(detectReportImageKind(webp), "webp");
  assert.equal(detectReportImageKind(heic), "heic");
  assert.match(unsupportedReportPhotographMessage("site.heic · today", "heic"), /site\.heic is a HEIC or HEIF photograph/);
  assert.match(unsupportedReportPhotographMessage("site.webp", "webp"), /site\.webp is a WebP photograph/);
  assert.match(unsupportedReportPhotographMessage("notes.txt", "unknown"), /not a JPEG, PNG, WebP, HEIC, or HEIF/);
  assert.doesNotThrow(() => assertReportPhotographCount(20));
  assert.throws(() => assertReportPhotographCount(41), /41 photographs/);
});

test("JPEG orientation is read from EXIF without rotating the file", () => {
  const bytes = jpegWithOrientation(6);
  assert.equal(readReportImageOrientation(bytes, "jpeg"), 6);
  assert.equal(readReportImageOrientation(jpegWithOrientation(1), "jpeg"), 1);
  assert.deepEqual(orientedPixelSize(4032, 3024, 6), { width: 3024, height: 4032 });
  assert.deepEqual(orientedPixelSize(4032, 3024, 1), { width: 4032, height: 3024 });
});

test("JPEG and PNG photographs keep their upright colours and proportions", async () => {
  const mismatches = [];
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const stored = await quadrantJpeg(orientation);
    const upright = await sharp(stored).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rendered = await renderPlacedJpeg(stored);
    assert.equal(readReportImageOrientation(stored, "jpeg"), orientation);
    for (const corner of ["tl", "tr", "bl", "br"] as const) {
      const expected = sampleRaw(upright.data, upright.info.width, upright.info.height, corner);
      const actual = sampleCanvas(rendered.pixels, rendered.width, rendered.height, rendered.box, corner);
      if (!closeColor(expected, actual)) {
        mismatches.push(`${orientation} ${corner} expected ${expected.join(",")} got ${actual.join(",")}`);
      }
    }
  }
  assert.deepEqual(mismatches, []);

  const png = await sharp({
    create: { width: 40, height: 20, channels: 3, background: { r: 20, g: 90, b: 180 } },
  })
    .png()
    .toBuffer();
  const pdf = await buildInstallationCompletionReportPdf(photoReport("elevation.png", png));
  const document = await PDFDocument.load(pdf);
  assert.ok(document.getPageCount() >= 1);
  assert.match(await extractPdfText(pdf), /elevation\.png/);
});

test("accepted photographs are resized without changing the original bytes", async () => {
  const mismatches = [];
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const stored = await quadrantJpeg(orientation);
    const original = Buffer.from(stored);
    const prepared = await prepareReportPhotograph(stored, `orient-${orientation}.jpg`);
    assert.deepEqual(Buffer.from(stored), original);
    assert.equal(detectReportImageKind(prepared), "jpeg");
    assert.equal(readReportImageOrientation(prepared, "jpeg"), 1);
    const upright = await sharp(stored).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = await sharp(prepared).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const corner of ["tl", "tr", "bl", "br"] as const) {
      const expected = sampleRaw(upright.data, upright.info.width, upright.info.height, corner);
      const actual = sampleRaw(decoded.data, decoded.info.width, decoded.info.height, corner);
      if (!closeColor(expected, actual)) {
        mismatches.push(`${orientation} ${corner} expected ${expected.join(",")} got ${actual.join(",")}`);
      }
    }
  }
  assert.deepEqual(mismatches, []);

  const phone = await sharp({
    create: { width: 2400, height: 800, channels: 3, background: { r: 30, g: 90, b: 180 } },
  })
    .jpeg()
    .toBuffer();
  const resized = await prepareReportPhotograph(phone, "android.jpg");
  const resizedMeta = await sharp(resized).metadata();
  assert.equal(resizedMeta.format, "jpeg");
  assert.equal(Math.max(resizedMeta.width ?? 0, resizedMeta.height ?? 0), 1600);

  const webp = await sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 210, g: 40, b: 50 } },
  })
    .webp()
    .toBuffer();
  assert.equal(detectReportImageKind(await prepareReportPhotograph(webp, "panel.webp")), "jpeg");

  const opaquePng = await sharp({
    create: { width: 24, height: 16, channels: 3, background: { r: 20, g: 80, b: 200 } },
  })
    .png()
    .toBuffer();
  assert.equal(detectReportImageKind(await prepareReportPhotograph(opaquePng, "site.png")), "jpeg");

  const transparentPng = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.4 } },
  })
    .png()
    .toBuffer();
  assert.equal(detectReportImageKind(await prepareReportPhotograph(transparentPng, "stroke.png")), "png");

  const heic = await readFile(new URL("./fixtures/sample.heic", import.meta.url));
  assert.equal(detectReportImageKind(heic), "heic");
  assert.equal(heic.subarray(8, 12).toString("ascii"), "mif1");
  const heicOriginal = Buffer.from(heic);
  const preparedHeic = await prepareReportPhotograph(heic, "iphone.heic");
  assert.deepEqual(Buffer.from(heic), heicOriginal);
  assert.equal(detectReportImageKind(preparedHeic), "jpeg");
  const heicMeta = await sharp(preparedHeic).metadata();
  assert.ok((heicMeta.width ?? 0) > 0 && (heicMeta.width ?? 0) <= 1600);
  assert.ok((heicMeta.height ?? 0) > 0 && (heicMeta.height ?? 0) <= 1600);

  const pdf = await buildInstallationCompletionReportPdf({
    ...photoReport("iphone.heic", heic),
    signaturePng: transparentPng,
    photos: [
      { phaseLabel: "Before installation", images: [{ id: "before", caption: "before.jpg", bytes: phone }] },
      { phaseLabel: "During installation", images: [{ id: "during", caption: "during.webp", bytes: webp }] },
      { phaseLabel: "After installation", images: [{ id: "after", caption: "after.heic", bytes: heic }] },
    ],
    snags: [
      {
        description: "Panel needs a second clip",
        statusLabel: "Open",
        outstanding: true,
        assignee: "Alex Installer",
        resolutionNotes: null,
        issuePhotos: [{ id: "snag", caption: "snag.png", bytes: opaquePng }],
        resolutionPhotos: [],
      },
    ],
  });
  const saved = Buffer.from(pdf).toString("latin1");
  assert.match(saved, /\/DCTDecode/);
  assert.match(saved, /\/SMask/);
  const text = await extractPdfText(pdf);
  assert.match(text, /before\.jpg/);
  assert.match(text, /during\.webp/);
  assert.match(text, /after\.heic/);
  assert.match(text, /snag\.png/);
});

test("unreadable photographs fail the report instead of being omitted", async () => {
  const heic = new Uint8Array(16);
  heic.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0);
  await assert.rejects(
    () => buildInstallationCompletionReportPdf(photoReport("iphone.HEIC", heic)),
    /iphone\.HEIC could not be read/
  );

  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  await assert.rejects(
    () => buildInstallationCompletionReportPdf(photoReport("panel.webp", webp)),
    /panel\.webp could not be read/
  );
});

function photoReport(name: string, bytes: Uint8Array): CompletionReportPdfInput {
  return {
    reportReference: "ICR-J-7-V1.1",
    versionNumber: 1,
    generatedAtLabel: "10 Nov 2026, 18:00",
    jobReference: "J-7",
    quoteReference: "Q-7",
    companyName: "Northwind Displays",
    siteAddress: "1 Harbour Street",
    scheduledAtLabel: "10 Nov 2026, 09:00",
    completedAtLabel: null,
    installers: ["Alex Installer"],
    visitStatusLabel: "Completed",
    visitTitle: "Shopfront signs",
    visitNumber: 1,
    projectStatusLabel: "Active",
    workDetails: [],
    checklist: {
      siteLeftSafeAndTidy: true,
      installationPhotosRecorded: true,
      recordedBy: "Alex Installer",
      recordedAtLabel: "10 Nov 2026, 18:00",
    },
    snags: [],
    attendance: "present",
    customerName: "Jamie Client",
    declineReason: null,
    signedAtLabel: "10 Nov 2026, 18:00",
    signOffRecordedBy: "Alex Installer",
    signaturePng: PNG,
    photos: [{ phaseLabel: "Before installation", images: [{ id: "photo", caption: name, bytes }] }],
    includeQuotationAppendix: false,
  };
}

async function quadrantJpeg(orientation: number) {
  const width = 80;
  const height = 40;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const left = x < width / 2;
      const top = y < height / 2;
      const color = top
        ? left
          ? [210, 30, 30]
          : [30, 170, 50]
        : left
          ? [30, 50, 210]
          : [230, 210, 40];
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .withMetadata({ orientation })
    .toBuffer();
}

async function renderPlacedJpeg(bytes: Buffer) {
  const doc = await PDFDocument.create();
  const pageWidth = 320;
  const pageHeight = 240;
  const page = doc.addPage([pageWidth, pageHeight]);
  const embedded = await doc.embedJpg(bytes);
  const orientation = readReportImageOrientation(bytes, "jpeg");
  const visual = orientedPixelSize(embedded.width, embedded.height, orientation);
  const maxSide = 120;
  const aspect = visual.height / visual.width;
  const box = aspect > 1
    ? { x: 40, y: 40, width: maxSide / aspect, height: maxSide }
    : { x: 40, y: 40, width: maxSide, height: maxSide * aspect };
  const placement = placeOrientedPhotograph(box, orientation);
  page.drawImage(embedded, { ...placement, rotate: degrees(placement.rotate) });
  const saved = await doc.save();
  const task = getDocument({
    data: new Uint8Array(saved),
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
  });
  const pdf = await task.promise;
  const pdfPage = await pdf.getPage(1);
  const scale = 2;
  const viewport = pdfPage.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  await pdfPage.render({
    canvas: null,
    canvasContext: canvas.getContext("2d"),
    viewport,
  }).promise;
  return {
    pixels: canvas.getContext("2d").getImageData(0, 0, viewport.width, viewport.height).data,
    width: viewport.width,
    height: viewport.height,
    box: {
      x: box.x * scale,
      y: (pageHeight - box.y - box.height) * scale,
      width: box.width * scale,
      height: box.height * scale,
    },
  };
}

function sampleRaw(data: Buffer, width: number, height: number, corner: "tl" | "tr" | "bl" | "br") {
  const x = corner === "tl" || corner === "bl" ? Math.floor(width * 0.25) : Math.floor(width * 0.75);
  const y = corner === "tl" || corner === "tr" ? Math.floor(height * 0.25) : Math.floor(height * 0.75);
  const offset = (y * width + x) * 4;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

function sampleCanvas(
  data: Uint8ClampedArray,
  width: number,
  _height: number,
  box: { x: number; y: number; width: number; height: number },
  corner: "tl" | "tr" | "bl" | "br"
) {
  const fx = corner === "tl" || corner === "bl" ? 0.25 : 0.75;
  const fy = corner === "tl" || corner === "tr" ? 0.25 : 0.75;
  const x = Math.floor(box.x + box.width * fx);
  const y = Math.floor(box.y + box.height * fy);
  const offset = (y * width + x) * 4;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

function closeColor(expected: number[], actual: number[]) {
  return expected.every((channel, index) => Math.abs(channel - actual[index]) <= 45);
}

function jpegWithOrientation(orientation: number) {
  const bytes = [
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x26,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
    orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x00,
  ];
  return Uint8Array.from(bytes);
}
