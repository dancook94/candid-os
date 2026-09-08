import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
});
