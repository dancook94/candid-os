export function isMissingProductionSchemaError(error: {
  code?: string;
  message?: string;
}) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    Boolean(error.message?.includes("Could not find the table")) ||
    Boolean(
      error.message?.includes("relation") &&
        error.message.includes("production_items")
    ) ||
    Boolean(
      error.message?.includes("relation") && error.message.includes("does not exist")
    )
  );
}

export function isMissingManifestSchemaError(error: {
  code?: string;
  message?: string;
}) {
  return (
    isMissingProductionSchemaError(error) ||
    Boolean(error.message?.includes("production_requirement_status")) ||
    Boolean(error.message?.includes("billing_status")) ||
    Boolean(error.message?.includes("source_type"))
  );
}

export class ProductionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProductionError";
    this.status = status;
  }
}
