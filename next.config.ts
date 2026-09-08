import type { NextConfig } from "next";

const quotePdfTracingIncludes = [
  "./node_modules/pdfkit/js/data/**",
  "./public/LOGO_YELLOW.svg",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "sharp", "@napi-rs/canvas", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/admin/quotes/[id]/pdf": quotePdfTracingIncludes,
    "/api/quotes/[id]/pdf": quotePdfTracingIncludes,
  },
};

export default nextConfig;
