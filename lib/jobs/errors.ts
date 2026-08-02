export class JobError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "JobError";
    this.status = status;
  }
}

export function isMissingJobsSchemaError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    Boolean(error.message?.includes("Could not find the table")) ||
    Boolean(
      error.message?.includes("relation") && error.message.includes("does not exist")
    )
  );
}
