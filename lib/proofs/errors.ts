export class ProofError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProofError";
    this.status = status;
  }
}

export function isMissingProofSchemaError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    Boolean(error.message?.includes("Could not find the table")) ||
    Boolean(error.message?.includes("job_proofs")) ||
    Boolean(
      error.message?.includes("relation") && error.message.includes("does not exist")
    )
  );
}

export function proofErrorResponse(error: unknown) {
  if (error instanceof ProofError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (process.env.NODE_ENV === "development" && error instanceof Error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ error: "Request failed." }, { status: 500 });
}
