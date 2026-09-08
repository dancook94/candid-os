type ProofGenerationErrorLog = {
  name: string;
  message: string;
  stack?: string;
  cause?: ProofGenerationErrorLog;
};

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

export function logProofGenerationError(
  label: string,
  error: unknown,
  context?: Record<string, unknown>
) {
  console.error(label, {
    ...(context ?? {}),
    error: proofGenerationErrorChain(error),
  });
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
  if (detail && Object.keys(detail).length > 0) {
    console.info(`[proof-generator] stage=${stage}`, detail);
    return;
  }

  console.info(`[proof-generator] stage=${stage}`);
}
