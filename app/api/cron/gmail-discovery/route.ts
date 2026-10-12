import { handleGmailDiscoveryCron } from "@/lib/gmail/cron-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export function GET(request: Request) {
  return handleGmailDiscoveryCron(request);
}
