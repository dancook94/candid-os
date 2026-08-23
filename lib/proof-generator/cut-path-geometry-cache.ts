import type { CutPathExtractionResult } from "@/lib/proof-generator/extract-cut-path-geometry";
import { extractCutPathGeometry } from "@/lib/proof-generator/extract-cut-path-geometry";
import {
  PROOF_GENERATOR_TIMEOUTS,
  withProofGeneratorTimeout,
} from "@/lib/proof-generator/runtime";

export class CutPathGeometryCache {
  private readonly entries = new Map<string, Promise<CutPathExtractionResult>>();

  private cacheKey(name: string, pageIndex: number) {
    return `${name}::${pageIndex}`;
  }

  extract(
    sourceBuffer: Buffer,
    cutPathName: string,
    pageIndex = 0,
    options?: { debugLabel?: string }
  ): Promise<CutPathExtractionResult> {
    const key = this.cacheKey(cutPathName, pageIndex);
    const existing = this.entries.get(key);
    if (existing) {
      return existing;
    }

    const pending = withProofGeneratorTimeout(
      "Cut-path extraction",
      PROOF_GENERATOR_TIMEOUTS.cutPathExtractionMs,
      () =>
        extractCutPathGeometry(sourceBuffer, cutPathName, pageIndex, {
          debugLabel: options?.debugLabel,
        })
    );

    this.entries.set(key, pending);
    return pending;
  }
}
