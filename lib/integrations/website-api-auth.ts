import { cronAuthorizationMatches } from "@/lib/gmail/cron-auth";

export const WEBSITE_API_SECRET_ENV = "CANDID_OS_WEBSITE_API_SECRET";

export function websiteApiSecret() {
  const secret = process.env[WEBSITE_API_SECRET_ENV]?.trim() ?? "";
  return secret || null;
}

export function websiteAuthorizationMatches(authorization: string | null) {
  return cronAuthorizationMatches(authorization, websiteApiSecret() ?? undefined);
}
