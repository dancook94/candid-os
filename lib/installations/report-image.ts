export type ReportImageKind = "jpeg" | "png" | "webp" | "heic" | "unknown";

export const REPORT_PHOTO_MAX_EDGE = 1600;
export const REPORT_JPEG_QUALITY = 82;
export const REPORT_MAX_PHOTOGRAPHS = 40;
export const REPORT_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const REPORT_MAX_SOURCE_PIXELS = 60_000_000;

type Raster = {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
};

export type OrientedImagePlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
};

const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "heif",
  "mif1",
  "msf1",
]);

export function detectReportImageKind(bytes: Uint8Array): ReportImageKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (isHeif(bytes)) return "heic";
  return "unknown";
}

export function readReportImageOrientation(bytes: Uint8Array, kind: ReportImageKind) {
  if (kind === "jpeg") return readJpegOrientation(bytes);
  if (kind === "png") return readPngOrientation(bytes);
  if (kind === "webp") return readWebpOrientation(bytes);
  return 1;
}

export function assertReportPhotographCount(count: number) {
  if (count > REPORT_MAX_PHOTOGRAPHS) {
    throw new Error(
      `This report includes ${count} photographs. A completion report can include up to ${REPORT_MAX_PHOTOGRAPHS}.`
    );
  }
}

/**
 * Resize a photograph for the PDF. The returned bytes are a new image.
 * The original storage object is never written back.
 */
export async function prepareReportPhotograph(bytes: Uint8Array, caption: string) {
  const label = photographLabel(caption);
  if (bytes.byteLength > REPORT_MAX_SOURCE_BYTES) {
    const megabytes = (bytes.byteLength / (1024 * 1024)).toFixed(1);
    throw new Error(`${label} is ${megabytes} MB. Each completion report photograph must be 12 MB or smaller.`);
  }

  const kind = detectReportImageKind(bytes);
  if (kind === "unknown") {
    throw new Error(unsupportedReportPhotographMessage(caption, kind));
  }

  const storedSize = kind === "jpeg" ? readJpegSize(bytes) : kind === "png" ? readPngSize(bytes) : null;
  if (storedSize) assertSourcePixels(label, storedSize.width, storedSize.height);

  let decoded: Raster;
  try {
    const codecs = await import("@/lib/installations/report-codecs");
    decoded = await codecs.decodeReportImage(bytes, kind, REPORT_MAX_SOURCE_PIXELS);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (/megapixels|maxResolutionInMP|maxMemoryUsageInMB/i.test(reason)) {
      throw new Error(`${label} is too large to include in the completion report. Each photograph must be 60 megapixels or smaller.`);
    }
    throw new Error(`${label} could not be read for the completion report.`);
  }

  assertSourcePixels(label, decoded.width, decoded.height);
  const upright = applyOrientation(decoded, readReportImageOrientation(bytes, kind));
  const resized = resizeLongestEdge(upright, REPORT_PHOTO_MAX_EDGE);
  const codecs = await import("@/lib/installations/report-codecs");
  if (hasTransparency(resized.data)) return codecs.encodeReportPng(resized);
  return codecs.encodeReportJpeg(resized, REPORT_JPEG_QUALITY);
}

export function orientedPixelSize(width: number, height: number, orientation: number) {
  if (orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

/**
 * Place a stored JPEG or PNG so its EXIF orientation is upright.
 * pdf-lib draws the stored pixel grid from its lower-left corner, then
 * rotates around that corner. The returned width and height are the stored
 * axes, which swap for orientations 5–8.
 */
export function placeOrientedPhotograph(
  box: { x: number; y: number; width: number; height: number },
  orientation: number
): OrientedImagePlacement {
  const { x, y, width, height } = box;
  switch (orientation) {
    case 2:
      return { x: x + width, y, width: -width, height, rotate: 0 };
    case 3:
      return { x: x + width, y: y + height, width, height, rotate: 180 };
    case 4:
      return { x, y: y + height, width, height: -height, rotate: 0 };
    case 5:
      return { x: x + width, y: y + height, width: height, height: -width, rotate: -90 };
    case 6:
      return { x, y: y + height, width: height, height: width, rotate: -90 };
    case 7:
      return { x, y, width: height, height: -width, rotate: 90 };
    case 8:
      return { x: x + width, y, width: height, height: width, rotate: 90 };
    default:
      return { x, y, width, height, rotate: 0 };
  }
}

export function unsupportedReportPhotographMessage(caption: string, kind: ReportImageKind) {
  const label = photographLabel(caption);
  if (kind === "heic") {
    return `${label} is a HEIC or HEIF photograph that could not be read for the completion report.`;
  }
  if (kind === "webp") {
    return `${label} is a WebP photograph that could not be read for the completion report.`;
  }
  return `${label} is not a JPEG, PNG, WebP, HEIC, or HEIF photograph, so it cannot be included in the completion report.`;
}

export function unreadableReportPhotographMessage(caption: string) {
  return `${photographLabel(caption)} could not be embedded. Use a standard JPEG or PNG photograph.`;
}

function photographLabel(caption: string) {
  const name = caption.split(" · ")[0]?.trim();
  return name || "This photograph";
}

function assertSourcePixels(label: string, width: number, height: number) {
  if (width < 1 || height < 1 || width * height > REPORT_MAX_SOURCE_PIXELS) {
    throw new Error(
      `${label} is ${width} x ${height} pixels. Each completion report photograph must be 60 megapixels or smaller.`
    );
  }
}

function applyOrientation(raster: Raster, orientation: number): Raster {
  if (orientation <= 1 || orientation > 8) return raster;
  const { width, height, data } = raster;
  const swapsAxes = orientation >= 5;
  const outWidth = swapsAxes ? height : width;
  const outHeight = swapsAxes ? width : height;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let nextX = x;
      let nextY = y;
      if (orientation === 2) nextX = width - 1 - x;
      if (orientation === 3) {
        nextX = width - 1 - x;
        nextY = height - 1 - y;
      }
      if (orientation === 4) nextY = height - 1 - y;
      if (orientation === 5) {
        nextX = y;
        nextY = x;
      }
      if (orientation === 6) {
        nextX = height - 1 - y;
        nextY = x;
      }
      if (orientation === 7) {
        nextX = height - 1 - y;
        nextY = width - 1 - x;
      }
      if (orientation === 8) {
        nextX = y;
        nextY = width - 1 - x;
      }
      const from = (y * width + x) * 4;
      const to = (nextY * outWidth + nextX) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }

  return { width: outWidth, height: outHeight, data: out };
}

function resizeLongestEdge(raster: Raster, maxEdge: number): Raster {
  const longest = Math.max(raster.width, raster.height);
  if (longest <= maxEdge) return raster;
  const width = Math.max(1, Math.round((raster.width * maxEdge) / longest));
  const height = Math.max(1, Math.round((raster.height * maxEdge) / longest));
  const out = new Uint8ClampedArray(width * height * 4);
  const source = raster.data;

  for (let y = 0; y < height; y += 1) {
    const yStart = Math.floor((y * raster.height) / height);
    const yEnd = Math.max(yStart + 1, Math.floor(((y + 1) * raster.height) / height));
    for (let x = 0; x < width; x += 1) {
      const xStart = Math.floor((x * raster.width) / width);
      const xEnd = Math.max(xStart + 1, Math.floor(((x + 1) * raster.width) / width));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;
      for (let sampleY = yStart; sampleY < yEnd; sampleY += 1) {
        for (let sampleX = xStart; sampleX < xEnd; sampleX += 1) {
          const offset = (sampleY * raster.width + sampleX) * 4;
          red += source[offset];
          green += source[offset + 1];
          blue += source[offset + 2];
          alpha += source[offset + 3];
          count += 1;
        }
      }
      const offset = (y * width + x) * 4;
      out[offset] = Math.round(red / count);
      out[offset + 1] = Math.round(green / count);
      out[offset + 2] = Math.round(blue / count);
      out[offset + 3] = Math.round(alpha / count);
    }
  }

  return { width, height, data: out };
}

function hasTransparency(data: ArrayLike<number>) {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }
  return false;
}

function readJpegSize(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb);
    if (isStartOfFrame) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readPngSize(bytes: Uint8Array) {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = readUint32(bytes, 16, false);
  const height = readUint32(bytes, 20, false);
  if (!width || !height) return null;
  return { width, height };
}

function readWebpOrientation(bytes: Uint8Array) {
  const limit = Math.min(bytes.length - 6, 65_536);
  for (let offset = 0; offset < limit; offset += 1) {
    if (ascii(bytes, offset, 6) === "Exif\0\0") {
      return readTiffOrientation(bytes, offset + 6) ?? 1;
    }
  }
  return 1;
}

function isHeif(bytes: Uint8Array) {
  if (bytes.length < 12) return false;
  if (ascii(bytes, 4, 4) !== "ftyp") return false;
  return HEIF_BRANDS.has(ascii(bytes, 8, 4));
}

function readJpegOrientation(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return 1;
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) return 1;
    if (marker === 0xe1 && ascii(bytes, offset + 4, 6) === "Exif\0\0") {
      return readTiffOrientation(bytes, offset + 10) ?? 1;
    }
    offset += 2 + segmentLength;
  }
  return 1;
}

function readPngOrientation(bytes: Uint8Array) {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset, false);
    if (length == null) return 1;
    const type = ascii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    if (type === "eXIf") return readTiffOrientation(bytes, dataStart) ?? 1;
    if (type === "IEND") return 1;
    offset = dataStart + length + 4;
  }
  return 1;
}

function readTiffOrientation(bytes: Uint8Array, tiffStart: number) {
  if (tiffStart + 8 > bytes.length) return null;
  const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
  const big = bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d;
  if (!little && !big) return null;
  if (readUint16(bytes, tiffStart + 2, little) !== 42) return null;
  const ifdOffset = readUint32(bytes, tiffStart + 4, little);
  if (ifdOffset == null) return null;
  const ifd = tiffStart + ifdOffset;
  const count = readUint16(bytes, ifd, little);
  if (count == null) return null;
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (readUint16(bytes, entry, little) !== 0x0112) continue;
    const value = readUint16(bytes, entry + 8, little);
    if (value != null && value >= 1 && value <= 8) return value;
  }
  return null;
}

function readUint16(bytes: Uint8Array, offset: number, little: boolean) {
  if (offset + 2 > bytes.length) return null;
  return little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number, little: boolean) {
  if (offset + 4 > bytes.length) return null;
  return little
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    : ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (offset + length > bytes.length) return "";
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index]);
  }
  return text;
}
