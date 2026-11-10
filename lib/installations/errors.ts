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
  return (
    lower.includes("installation_projects") &&
    (lower.includes("does not exist") || lower.includes("schema cache"))
  );
}
