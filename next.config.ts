import type { NextConfig } from "next";

const quotePdfTracingIncludes = [
  "./node_modules/pdfkit/js/data/**",
  "./public/LOGO_YELLOW.png",
];

const proofGeneratorTracingIncludes = [
  "./node_modules/sharp/**",
  "./node_modules/@img/sharp-linux-x64/**",
  "./node_modules/@img/sharp-libvips-linux-x64/**",
  "./node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.3",
  "./node_modules/@img/sharp-linuxmusl-x64/**",
  "./node_modules/@img/sharp-libvips-linuxmusl-x64/**",
  "./node_modules/@img/sharp-libvips-linuxmusl-x64/lib/libvips-cpp.so.8.18.3",
  "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
  "./node_modules/@napi-rs/canvas-linux-x64-musl/**",
  "./public/LOGO_YELLOW.svg",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "sharp", "@napi-rs/canvas", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/admin/quotes/[id]/pdf": quotePdfTracingIncludes,
    "/api/quotes/[id]/pdf": quotePdfTracingIncludes,
    "/api/admin/jobs/[id]/proofs/[proofId]/branded-pdf/analyse":
      proofGeneratorTracingIncludes,
    "/api/admin/jobs/[id]/proofs/[proofId]/branded-pdf/generate":
      proofGeneratorTracingIncludes,
  },
};

export default nextConfig;
