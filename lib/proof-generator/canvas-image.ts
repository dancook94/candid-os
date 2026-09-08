import { createCanvas, loadImage } from "@napi-rs/canvas";

export function countDarkPixelsFromRgba(data: Uint8ClampedArray, threshold = 80) {
  let count = 0;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index]!;
    const green = data[index + 1]!;
    const blue = data[index + 2]!;

    if (red < threshold && green < threshold && blue < threshold) {
      count += 1;
    }
  }

  return count;
}

export async function countDarkPixelsFromPng(pngBuffer: Buffer, threshold = 80) {
  const image = await loadImage(pngBuffer);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  return countDarkPixelsFromRgba(data, threshold);
}

export async function resizeImageBufferToPng(sourceBuffer: Buffer, maxPx: number) {
  const image = await loadImage(sourceBuffer);
  const scale = Math.min(1, maxPx / image.width, maxPx / image.height);
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  return canvas.toBuffer("image/png");
}

export async function loadAndResizeLogoPng(sourcePath: string, targetWidth: number) {
  const image = await loadImage(sourcePath);
  const aspect = image.height / image.width;
  const targetHeight = Math.max(1, Math.round(targetWidth * aspect));
  const canvas = createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  return canvas.toBuffer("image/png");
}
