import { NextResponse } from "next/server";

import { requireCustomerQuoteRequestContext } from "@/lib/customer-settings/auth";
import { notifyInternalQuoteRequestReceivedSafe } from "@/lib/notifications/triggers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { quoteRequestId?: string };

  try {
    body = (await request.json()) as { quoteRequestId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const quoteRequestId = body.quoteRequestId?.trim();

  if (!quoteRequestId) {
    return NextResponse.json({ error: "Quote request ID is required." }, { status: 400 });
  }

  const context = await requireCustomerQuoteRequestContext(supabase, user);

  const { data: quoteRequest, error: quoteRequestError } = await supabase
    .from("quote_requests")
    .select("id, company_id, contact_id, request_status")
    .eq("id", quoteRequestId)
    .maybeSingle();

  if (quoteRequestError || !quoteRequest) {
    return NextResponse.json({ error: "Quote request not found." }, { status: 404 });
  }

  if (
    quoteRequest.company_id !== context.company.id ||
    quoteRequest.contact_id !== context.contact.id
  ) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (quoteRequest.request_status !== "submitted") {
    return NextResponse.json(
      { ok: false, skipped: true, reason: "not_submitted" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();
  const notification = await notifyInternalQuoteRequestReceivedSafe(adminClient, {
    quoteRequestId,
    companyId: quoteRequest.company_id as string,
    contactId: quoteRequest.contact_id as string,
  });

  return NextResponse.json({
    ok: notification.ok,
    quoteRequestId,
    notification,
  });
}
