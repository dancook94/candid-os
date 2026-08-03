#!/usr/bin/env node

/**
 * Fails if legacy PrintFactory v1 job endpoints appear in production client code.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "lib/printfactory");
const FORBIDDEN = ["/api/v1/jobs", "api/v1/jobs"];
const SKIP_FILES = new Set(["endpoints.ts"]);

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

const violations = [];

for (const file of walk(ROOT)) {
  const basename = file.split("/").pop() ?? file;

  if (SKIP_FILES.has(basename)) {
    continue;
  }

  const content = readFileSync(file, "utf8");

  for (const snippet of FORBIDDEN) {
    if (content.includes(snippet)) {
      violations.push(`${file}: contains "${snippet}"`);
    }
  }
}

if (violations.length > 0) {
  console.error("PrintFactory endpoint policy check failed:\n");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log("PrintFactory endpoint policy check passed.");
