const ENABLED_VALUE = "true";

export function isPublicRegistrationEnabled(): boolean {
  return (
    process.env.CANDID_PUBLIC_REGISTRATION_ENABLED?.trim().toLowerCase() ===
    ENABLED_VALUE
  );
}

export function assertPublicRegistrationEnabled():
  | { ok: true }
  | { ok: false; message: string } {
  if (isPublicRegistrationEnabled()) {
    return { ok: true };
  }

  return {
    ok: false,
    message: "Candid OS registration is currently unavailable.",
  };
}

export const PUBLIC_REGISTRATION_UNAVAILABLE_MESSAGE =
  "Candid OS registration is currently unavailable.";
