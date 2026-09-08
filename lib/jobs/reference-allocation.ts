export type PostgresUniqueViolationKind = "job_reference" | "quote_id" | "unknown";

type PostgresErrorLike = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

export function classifyPostgresUniqueViolation(
  error: PostgresErrorLike
): PostgresUniqueViolationKind | null {
  if (error.code !== "23505") {
    return null;
  }

  const combined = [
    error.message,
    error.details,
    error.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    combined.includes("jobs_job_reference_idx") ||
    combined.includes("(job_reference)")
  ) {
    return "job_reference";
  }

  if (
    combined.includes("jobs_one_per_quote") ||
    combined.includes("(quote_id)")
  ) {
    return "quote_id";
  }

  return "unknown";
}

export function logJobCreateInsertError(input: {
  quoteId: string;
  candidateReference: string;
  error: PostgresErrorLike;
}) {
  const violationKind = classifyPostgresUniqueViolation(input.error);

  console.error("[JOB CREATE]", {
    quote_id: input.quoteId,
    candidate_reference: input.candidateReference,
    code: input.error.code ?? null,
    constraint: violationKind,
    message: input.error.message ?? null,
    details: input.error.details ?? null,
  });
}

export function logJobCreateReferenceCollisionRecovery(input: {
  quoteId: string;
  preferredReference: string;
  allocatedReference: string;
}) {
  console.info("[JOB CREATE]", {
    quote_id: input.quoteId,
    preferred_reference: input.preferredReference,
    collision: true,
    allocated_reference: input.allocatedReference,
  });
}

/** Maximum insert attempts when resolving job_reference unique collisions. */
export const JOB_REFERENCE_INSERT_MAX_ATTEMPTS = 6;
