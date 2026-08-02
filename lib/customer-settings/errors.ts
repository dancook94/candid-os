export class CustomerSettingsError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CustomerSettingsError";
    this.status = status;
  }
}

export function isMissingRelationError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    (error.message?.includes("relation") &&
      error.message.includes("does not exist"))
  );
}
