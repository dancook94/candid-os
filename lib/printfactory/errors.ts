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
    | "invalid_request"
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
