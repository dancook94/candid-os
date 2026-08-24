import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "sharp", "@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
