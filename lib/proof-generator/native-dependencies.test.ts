import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

function packageLockEntry(packageName: string, lockfile: string) {
  const escaped = packageName.replace("/", "\\/");
  const pattern = new RegExp(
    `"node_modules/${escaped}":\\s*\\{\\s*"version":\\s*"([^"]+)"`
  );
  const match = lockfile.match(pattern);
  assert.ok(match, `Expected ${packageName} in package-lock.json`);
  return match[1];
}

function readJsonField(source: string, field: string) {
  const match = source.match(new RegExp(`"${field}":\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, "m"));
  assert.ok(match, `Expected ${field} section`);
  return `{${match[1]}\n}`;
}

describe("proof generator native dependency packaging", () => {
  it("forces Node.js runtime on branded PDF analyse and generate routes", async () => {
    const analyseRoute = await readRepoFile(
      "app/api/admin/jobs/[id]/proofs/[proofId]/branded-pdf/analyse/route.ts"
    );
    const generateRoute = await readRepoFile(
      "app/api/admin/jobs/[id]/proofs/[proofId]/branded-pdf/generate/route.ts"
    );

    assert.match(analyseRoute, /export const runtime = "nodejs"/);
    assert.match(generateRoute, /export const runtime = "nodejs"/);
    assert.match(generateRoute, /export const maxDuration = 180/);
  });

  it("declares Linux native packages as project optionalDependencies", async () => {
    const packageJson = await readRepoFile("package.json");
    const lockfile = await readRepoFile("package-lock.json");
    const optionalSection = readJsonField(packageJson, "optionalDependencies");

    const expected = {
      "@img/sharp-linux-x64": "0.35.3",
      "@img/sharp-libvips-linux-x64": "1.3.2",
      "@img/sharp-linuxmusl-x64": "0.35.3",
      "@img/sharp-libvips-linuxmusl-x64": "1.3.2",
      "@napi-rs/canvas-linux-x64-gnu": "1.0.8",
      "@napi-rs/canvas-linux-x64-musl": "1.0.8",
    };

    for (const [name, version] of Object.entries(expected)) {
      assert.match(optionalSection, new RegExp(`"${name.replace("/", "\\/")}": "${version}"`));
      assert.equal(packageLockEntry(name, lockfile), version);
    }

    assert.doesNotMatch(
      readJsonField(packageJson, "dependencies"),
      /@img\/sharp-linux-x64/
    );
  });

  it("includes proof route native tracing and preserves quote PDF tracing", async () => {
    const nextConfig = await readRepoFile("next.config.ts");
    const lockfile = await readRepoFile("package-lock.json");

    const sharpVersion = packageLockEntry("sharp", lockfile);
    const sharpLinuxVersion = packageLockEntry("@img/sharp-linux-x64", lockfile);
    const libvipsLinuxVersion = packageLockEntry(
      "@img/sharp-libvips-linux-x64",
      lockfile
    );
    const canvasLinuxGnuVersion = packageLockEntry(
      "@napi-rs/canvas-linux-x64-gnu",
      lockfile
    );
    const canvasLinuxMuslVersion = packageLockEntry(
      "@napi-rs/canvas-linux-x64-musl",
      lockfile
    );

    assert.equal(sharpVersion, "0.35.3");
    assert.equal(sharpLinuxVersion, "0.35.3");
    assert.equal(libvipsLinuxVersion, "1.3.2");
    assert.equal(canvasLinuxGnuVersion, "1.0.8");
    assert.equal(canvasLinuxMuslVersion, "1.0.8");

    assert.match(
      nextConfig,
      /\/api\/admin\/jobs\/\[id\]\/proofs\/\[proofId\]\/branded-pdf\/analyse/
    );
    assert.match(
      nextConfig,
      /\/api\/admin\/jobs\/\[id\]\/proofs\/\[proofId\]\/branded-pdf\/generate/
    );

    assert.match(nextConfig, /\.\/node_modules\/sharp\/\*\*/);
    assert.match(nextConfig, /\.\/node_modules\/@img\/sharp-linux-x64\/\*\*/);
    assert.match(nextConfig, /\.\/node_modules\/@img\/sharp-libvips-linux-x64\/\*\*/);
    assert.match(
      nextConfig,
      /\.\/node_modules\/@img\/sharp-libvips-linux-x64\/lib\/libvips-cpp\.so\.8\.18\.3/
    );
    assert.match(nextConfig, /\.\/node_modules\/@img\/sharp-linuxmusl-x64\/\*\*/);
    assert.match(
      nextConfig,
      /\.\/node_modules\/@img\/sharp-libvips-linuxmusl-x64\/\*\*/
    );
    assert.match(
      nextConfig,
      /\.\/node_modules\/@img\/sharp-libvips-linuxmusl-x64\/lib\/libvips-cpp\.so\.8\.18\.3/
    );
    assert.match(
      nextConfig,
      /\.\/node_modules\/@napi-rs\/canvas-linux-x64-gnu\/\*\*/
    );
    assert.match(
      nextConfig,
      /\.\/node_modules\/@napi-rs\/canvas-linux-x64-musl\/\*\*/
    );
    assert.match(nextConfig, /\.\/public\/LOGO_YELLOW\.svg/);

    assert.match(nextConfig, /serverExternalPackages:\s*\[[^\]]*"sharp"/);
    assert.match(nextConfig, /serverExternalPackages:\s*\[[^\]]*"@napi-rs\/canvas"/);

    assert.match(nextConfig, /\/api\/admin\/quotes\/\[id\]\/pdf/);
    assert.match(nextConfig, /\/api\/quotes\/\[id\]\/pdf/);
    assert.match(nextConfig, /node_modules\/pdfkit\/js\/data\/\*\*/);
    assert.match(nextConfig, /LOGO_YELLOW\.png/);
  });

  it("loads image analysis dynamically so PDF preflight does not eagerly import sharp", async () => {
    const service = await readRepoFile("lib/proof-generator/service.ts");

    assert.doesNotMatch(service, /import \{ analyseImageBuffer \} from "@\/lib\/proof-generator\/analyse-image"/);
    assert.match(
      service,
      /await import\(\s*"@\/lib\/proof-generator\/analyse-image"\s*\)/
    );
    assert.match(service, /analyseImageBuffer\(/);
    assert.match(service, /artwork\.detectedKind === "pdf"/);
    assert.match(service, /artwork\.detectedKind === "ai_unsupported"/);
  });

  it("loads PDF generation dynamically so analyse does not eagerly import sharp", async () => {
    const service = await readRepoFile("lib/proof-generator/service.ts");

    assert.doesNotMatch(
      service,
      /import \{ generateCustomerProofPdf \} from "@\/lib\/proof-generator\/generate-proof-pdf"/
    );
    assert.doesNotMatch(service, /from "@\/lib\/proof-generator\/generate-proof-pdf"/);
    assert.doesNotMatch(service, /from "@\/lib\/proof-generator\/artwork-preview"/);
    assert.doesNotMatch(service, /from "@\/lib\/proof-generator\/pdf-brand"/);
    assert.doesNotMatch(service, /import sharp from "sharp"/);

    assert.match(
      service,
      /await import\(\s*"@\/lib\/proof-generator\/generate-proof-pdf"\s*\)/
    );
    assert.match(service, /generateCustomerProofPdf\(/);
    assert.match(service, /async function generateBrandedPdfForExistingProof/);
  });
});
