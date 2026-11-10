/// <reference path="./report-codecs.d.ts" />
import { createRequire } from "node:module";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { decode as decodeJpegFile } from "jpeg-js";
import { PNG } from "pngjs";
import libheifBundle from "libheif-js/wasm-bundle";

type ReportImageKind = "jpeg" | "png" | "webp" | "heic" | "unknown";

export type DecodedReportImage = {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
};

type JpegEncoder = (
  image: { data: Uint8ClampedArray; width: number; height: number },
  options: { quality: number; baseline: boolean; progressive: boolean; optimize_coding: boolean }
) => Promise<ArrayBuffer>;

const require = createRequire(path.join(process.cwd(), "package.json"));

let jpegEncoder: Promise<JpegEncoder> | null = null;
let webpDecoder: Promise<(input: Buffer) => Promise<DecodedReportImage>> | null = null;

export async function decodeReportImage(
  bytes: Uint8Array,
  kind: ReportImageKind,
  maxPixels: number
): Promise<DecodedReportImage> {
  if (kind === "jpeg") return decodeJpeg(bytes, maxPixels);
  if (kind === "png") return decodePng(bytes);
  if (kind === "webp") return decodeWebp(bytes);
  if (kind === "heic") return decodeHeif(bytes, maxPixels);
  throw new Error("Unsupported photograph.");
}

export async function encodeReportJpeg(image: DecodedReportImage, quality: number) {
  const encode = await loadJpegEncoder();
  const encoded = await encode(
    { data: asClamped(image.data), width: image.width, height: image.height },
    {
      quality,
      baseline: true,
      progressive: false,
      optimize_coding: true,
    }
  );
  return new Uint8Array(encoded);
}

export function encodeReportPng(image: DecodedReportImage) {
  const png = new PNG({ width: image.width, height: image.height });
  Buffer.from(image.data).copy(png.data);
  return new Uint8Array(PNG.sync.write(png));
}

function decodeJpeg(bytes: Uint8Array, maxPixels: number) {
  return decodeJpegFile(Buffer.from(bytes), {
    maxResolutionInMP: maxPixels / 1_000_000,
    maxMemoryUsageInMB: 320,
    useTArray: true,
  });
}

function decodePng(bytes: Uint8Array) {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: png.data };
}

async function decodeWebp(bytes: Uint8Array) {
  const decode = await loadWebpDecoder();
  return decode(Buffer.from(bytes));
}

async function decodeHeif(bytes: Uint8Array, maxPixels: number) {
  const libheif = libheifBundle;
  await libheif.ready;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(Buffer.from(bytes));
  try {
    const image = images[0];
    if (!image) throw new Error("no image was found");
    const width = image.get_width();
    const height = image.get_height();
    assertPixelCount(width, height, maxPixels);
    const data = new Uint8ClampedArray(width * height * 4);
    const displayed = await new Promise<Uint8ClampedArray>((resolve, reject) => {
      image.display({ data, width, height }, (result) => {
        if (!result) reject(new Error("the HEIF image could not be decoded"));
        else resolve(result.data);
      });
    });
    return { width, height, data: displayed };
  } finally {
    for (const image of images) image.free();
    decoder.decoder.delete();
  }
}

function assertPixelCount(width: number, height: number, maxPixels: number) {
  if (width < 1 || height < 1 || width * height > maxPixels) {
    throw new Error(`${width} x ${height} pixels exceeds ${maxPixels / 1_000_000} megapixels`);
  }
}

async function loadJpegEncoder() {
  if (!jpegEncoder) {
    jpegEncoder = import("@jsquash/jpeg/encode").then(async (mod) => {
      const wasm = await readFile(require.resolve("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"));
      await mod.init(await WebAssembly.compile(wasm));
      return mod.default as JpegEncoder;
    });
  }
  return jpegEncoder;
}

async function loadWebpDecoder() {
  if (!webpDecoder) {
    webpDecoder = import("@jsquash/webp/decode").then(async (mod) => {
      const wasm = await readFile(require.resolve("@jsquash/webp/codec/dec/webp_dec.wasm"));
      await mod.init(await WebAssembly.compile(wasm));
      return mod.default as unknown as (input: Buffer) => Promise<DecodedReportImage>;
    });
  }
  return webpDecoder;
}

function asClamped(data: Uint8Array | Uint8ClampedArray) {
  return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
}
