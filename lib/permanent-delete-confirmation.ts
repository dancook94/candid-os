export const PERMANENT_DELETE_CONFIRMATION_WORD = "DELETE";

export const PERMANENT_DELETE_CONFIRMATION_LABEL =
  "Type DELETE to confirm permanent deletion.";

export const PERMANENT_DELETE_CONFIRMATION_PLACEHOLDER = "DELETE";

export function isPermanentDeleteConfirmationValid(value: string) {
  return value.trim().toUpperCase() === PERMANENT_DELETE_CONFIRMATION_WORD;
}

export function permanentDeleteConfirmationErrorMessage() {
  return PERMANENT_DELETE_CONFIRMATION_LABEL;
}
