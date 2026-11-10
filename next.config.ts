import type { NextConfig } from "next";

const quotePdfTracingIncludes = [
  "./node_modules/pdfkit/js/data/**",
  "./public/LOGO_YELLOW.png",
];

const proofAnalyseTracingIncludes = [
  "./node_modules/sharp/**",
  "./node_modules/@img/sharp-linux-x64/**",
  "./node_modules/@img/sharp-libvips-linux-x64/**",
  "./node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.3",
  "./node_modules/@img/sharp-linuxmusl-x64/**",
  "./node_modules/@img/sharp-libvips-linuxmusl-x64/**",
  "./node_modules/@img/sharp-libvips-linuxmusl-x64/lib/libvips-cpp.so.8.18.3",
  "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
  "./node_modules/@napi-rs/canvas-linux-x64-musl/**",
];

const proofGenerateTracingIncludes = [
  "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
  "./node_modules/@napi-rs/canvas-linux-x64-musl/**",
  "./public/LOGO_YELLOW.png",
];

const completionReportTracingIncludes = [
  "./public/LOGO_YELLOW.png",
  "./node_modules/jpeg-js/**",
  "./node_modules/pngjs/**",
  "./node_modules/libheif-js/package.json",
  "./node_modules/libheif-js/wasm-bundle.js",
  "./node_modules/libheif-js/libheif-wasm/**",
  "./node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm",
  "./node_modules/@jsquash/webp/codec/dec/webp_dec.wasm",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "@napi-rs/canvas", "pdfjs-dist", "libheif-js", "@jsquash/jpeg", "@jsquash/webp"],
  outputFileTracingIncludes: {
    "/api/admin/quotes/[id]/pdf": quotePdfTracingIncludes,
    "/api/quotes/[id]/pdf": quotePdfTracingIncludes,
    "/api/admin/jobs/[id]/proofs/[proofId]/branded-pdf/analyse":
      proofAnalyseTracingIncludes,
    "/api/admin/jobs/[id]/proofs/[proofId]/branded-pdf/generate":
      proofGenerateTracingIncludes,
    "/api/admin/installations/visits/[visitId]/completion-report":
      completionReportTracingIncludes,
  },
};

export default nextConfig;
