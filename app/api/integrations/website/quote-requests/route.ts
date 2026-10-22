import { handleWebsiteQuoteRequest } from "@/lib/integrations/website-quote-request";
import { notifyWebsiteEnquiryReceivedSafe } from "@/lib/notifications/triggers";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleWebsiteQuoteRequest(request, {
    notifyStaff: (enquiry) =>
      notifyWebsiteEnquiryReceivedSafe(createAdminClient(), enquiry).then(() => undefined),
  });
}
