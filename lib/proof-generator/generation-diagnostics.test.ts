import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  logOriginalGenerationError,
  logProofGenerationErrorChain,
  PROOF_GENERATOR_DIAGNOSTICS_V2,
  proofGenerationErrorChain,
  wrapProofGenerationError,
} from "@/lib/proof-generator/generation-diagnostics";
import { ProofError } from "@/lib/proofs/errors";

describe("proof generation diagnostics", () => {
  it("wrapProofGenerationError preserves the original error as cause", () => {
    const original = new TypeError(
      'The "path" argument must be of type string. Received type number (55876)'
    );
    const wrapped = wrapProofGenerationError(
      "Branded proof PDF generation failed: test failure",
      original
    );

    assert.equal(wrapped.message, "Branded proof PDF generation failed: test failure");
    assert.equal(wrapped.cause, original);
    assert.match(String(wrapped.stack), /wrapProofGenerationError/);
    assert.match(String(original.stack), /TypeError/);
  });

  it("proofGenerationErrorChain serializes error and cause stacks for server logs", () => {
    const original = new TypeError("inner failure");
    const wrapped = new Error("outer failure", { cause: original });
    const serviceError = new ProofError(wrapped.message, 500, { cause: wrapped });

    const chain = proofGenerationErrorChain(serviceError);
    assert.ok(chain);
    assert.equal(chain?.name, "ProofError");
    assert.equal(chain?.message, "outer failure");
    assert.match(String(chain?.stack), /ProofError|Error/);
    assert.equal(chain?.cause?.name, "Error");
    assert.equal(chain?.cause?.message, "outer failure");
    assert.equal(chain?.cause?.cause?.name, "TypeError");
    assert.equal(chain?.cause?.cause?.message, "inner failure");
    assert.match(String(chain?.cause?.cause?.stack), /TypeError/);
  });

  it("client-facing ProofError payloads expose message only, not stack traces", () => {
    const original = new TypeError("secret stack detail");
    const wrapped = wrapProofGenerationError("Branded proof PDF generation failed.", original);
    const proofError = new ProofError(wrapped.message, 500, { cause: wrapped });

    const clientPayload = { error: proofError.message };

    assert.equal(clientPayload.error, "Branded proof PDF generation failed.");
    assert.equal(JSON.stringify(clientPayload).includes("secret stack detail"), false);
    assert.equal(JSON.stringify(clientPayload).includes("stack"), false);
  });

  it("logProofGenerationErrorChain walks nested causes", () => {
    const original = new TypeError("root failure");
    const wrapped = new Error("wrapped failure", { cause: original });
    const proofError = new ProofError(wrapped.message, 500, { cause: wrapped });

    const stderrLines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      logProofGenerationErrorChain("[proofs:branded-pdf:generate]", proofError, {
        jobId: "job-1",
        proofId: "proof-1",
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    const output = stderrLines.join("");
    assert.match(output, /cause-chain depth=0/);
    assert.match(output, /cause-chain depth=1/);
    assert.match(output, /cause-chain depth=2/);
    assert.match(output, /root failure/);
    assert.match(output, /PROOF_GENERATOR_DIAGNOSTICS_V2/);
  });

  it("logOriginalGenerationError includes diagnostics marker", () => {
    const stderrLines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      logOriginalGenerationError(new TypeError("path failure"), {
        stage: "test-catch",
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    const output = stderrLines.join("");
    assert.match(output, /ORIGINAL GENERATION ERROR/);
    assert.match(output, /PROOF_GENERATOR_DIAGNOSTICS_V2/);
    assert.match(output, /path failure/);
  });

  it("exports diagnostics version marker constant", () => {
    assert.equal(PROOF_GENERATOR_DIAGNOSTICS_V2, "PROOF_GENERATOR_DIAGNOSTICS_V2");
  });
});
