import { createHash, timingSafeEqual } from "node:crypto";

export function cronBearerToken(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) {
    return "";
  }

  return authorization.slice("Bearer ".length).trim();
}

export function cronAuthorizationMatches(authorization: string | null, secret: string | undefined) {
  const configured = secret?.trim() ?? "";
  const token = cronBearerToken(authorization);

  if (!configured || !token) {
    return false;
  }

  const actual = createHash("sha256").update(token).digest();
  const expected = createHash("sha256").update(configured).digest();
  return timingSafeEqual(actual, expected);
}
