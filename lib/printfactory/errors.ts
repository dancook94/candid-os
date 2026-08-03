export class PrintfactoryError extends Error {
  code:
    | "not_configured"
    | "auth_failed"
    | "unreachable"
    | "no_jobs"
    | "parse_failed"
    | "job_not_found"
    | "match_failed"
    | "sync_failed"
    | "unknown";

  status: number;

  constructor(
    message: string,
    code: PrintfactoryError["code"] = "unknown",
    status = 500
  ) {
    super(message);
    this.name = "PrintfactoryError";
    this.code = code;
    this.status = status;
  }
}

export function isMissingPrintfactorySchemaError(error: {
  message?: string;
  code?: string;
} | null) {
  if (!error) {
    return false;
  }

  const message = error.message?.toLowerCase() ?? "";

  return (
    error.code === "42P01" ||
    message.includes("printfactory_jobs") ||
    message.includes("does not exist")
  );
}
