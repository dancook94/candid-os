import { createRequire } from "node:module";

/**
 * pdfjs-dist constructs a DOMMatrix while the module is evaluated. Its Node
 * build loads that class from @napi-rs/canvas, but the cron function cannot
 * resolve that optional package. geometry.js is the canvas implementation
 * itself, with no native binding and no browser stand-in.
 */
const require = createRequire(import.meta.url);
const { DOMMatrix } = require("@napi-rs/canvas/geometry.js") as {
  DOMMatrix: typeof globalThis.DOMMatrix;
};

if (typeof globalThis.DOMMatrix !== "function") {
  globalThis.DOMMatrix = DOMMatrix;
}
