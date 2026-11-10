export class InstallationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "InstallationError";
    this.status = status;
  }
}

export function isMissingInstallationSchemaError(message: string) {
  const lower = message.toLowerCase();
  const missingObject =
    lower.includes("installation_projects") ||
    lower.includes("installation_reconcile_accepted_job") ||
    lower.includes("installation_auto_reconcile");
  const missingShape =
    lower.includes("does not exist") ||
    lower.includes("schema cache") ||
    lower.includes("could not find");

  return missingObject && missingShape;
}
