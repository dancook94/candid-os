export const PROOF_GENERATOR_DIAGNOSTICS_V2 = "PROOF_GENERATOR_DIAGNOSTICS_V2";

type ProofGenerationErrorLog = {
  name: string;
  message: string;
  stack?: string;
  cause?: ProofGenerationErrorLog;
};

function errorFields(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: typeof error,
    message: String(error),
    stack: undefined,
  };
}

export function proofGenerationErrorChain(
  error: unknown,
  depth = 0
): ProofGenerationErrorLog | null {
  if (depth > 8 || error == null) {
    return null;
  }

  if (error instanceof Error) {
    const cause =
      "cause" in error && error.cause !== undefined
        ? proofGenerationErrorChain(error.cause, depth + 1)
        : undefined;

    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(cause ? { cause } : {}),
    };
  }

  return {
    name: "NonErrorThrown",
    message: String(error),
  };
}

export function logOriginalGenerationError(
  error: unknown,
  context?: Record<string, unknown>
) {
  const fields = errorFields(error);
  console.error("[proof-generator] ORIGINAL GENERATION ERROR", {
    marker: PROOF_GENERATOR_DIAGNOSTICS_V2,
    ...(context ?? {}),
    ...fields,
    cause:
      error instanceof Error && "cause" in error && error.cause !== undefined
        ? errorFields(error.cause)
        : undefined,
  });

  if (error instanceof Error && error.cause instanceof Error) {
    console.error("[proof-generator] ORIGINAL GENERATION ERROR CAUSE", {
      marker: PROOF_GENERATOR_DIAGNOSTICS_V2,
      name: error.cause.name,
      message: error.cause.message,
      stack: error.cause.stack,
    });
  }
}

export function logProofGenerationErrorChain(
  label: string,
  error: unknown,
  context?: Record<string, unknown>
) {
  console.error(label, {
    marker: PROOF_GENERATOR_DIAGNOSTICS_V2,
    ...(context ?? {}),
  });

  let current: unknown = error;
  let depth = 0;

  while (current != null && depth < 8) {
    console.error(`${label} cause-chain depth=${depth}`, {
      marker: PROOF_GENERATOR_DIAGNOSTICS_V2,
      ...(context ?? {}),
      ...errorFields(current),
    });

    current =
      current instanceof Error && "cause" in current ? current.cause : undefined;
    depth += 1;
  }

  console.error(`${label} cause-chain-json`, {
    marker: PROOF_GENERATOR_DIAGNOSTICS_V2,
    ...(context ?? {}),
    error: proofGenerationErrorChain(error),
  });
}

/** @deprecated Use logProofGenerationErrorChain for route-level logging. */
export function logProofGenerationError(
  label: string,
  error: unknown,
  context?: Record<string, unknown>
) {
  logProofGenerationErrorChain(label, error, context);
}

export function wrapProofGenerationError(message: string, error: unknown) {
  if (error instanceof Error) {
    return new Error(message, { cause: error });
  }

  return new Error(message, { cause: error });
}

export function logProofGeneratorStageMarker(
  stage: string,
  detail?: Record<string, unknown>
) {
  const payload = {
    marker: PROOF_GENERATOR_DIAGNOSTICS_V2,
    ...(detail ?? {}),
  };

  console.error(`[proof-generator] stage=${stage}`, payload);
}
