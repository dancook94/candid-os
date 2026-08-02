type SupabaseQueryError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

export function logPortalSettingsQueryError(
  query: string,
  error: SupabaseQueryError
) {
  console.error("[portal settings] query failed", {
    query,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

export function isMissingRelationError(error: SupabaseQueryError) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    Boolean(error.message?.includes("Could not find the table")) ||
    Boolean(
      error.message?.includes("relation") &&
        error.message.includes("does not exist")
    )
  );
}

export function isMissingColumnError(error: SupabaseQueryError) {
  return (
    error.code === "PGRST204" ||
    Boolean(
      error.message?.includes("column") &&
        error.message.includes("does not exist")
    )
  );
}

export function isSchemaMismatchError(error: SupabaseQueryError) {
  return isMissingRelationError(error) || isMissingColumnError(error);
}

export function toCustomerFacingDatabaseMessage(
  error: SupabaseQueryError,
  fallback: string
) {
  if (process.env.NODE_ENV === "development" && error.message) {
    return error.message;
  }

  return fallback;
}
