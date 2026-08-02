import { NextResponse } from "next/server";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { resolveQuoteRequestIdForQuote } from "@/lib/quote-request-link";
import { createClient } from "@/lib/supabase/server";

type ResolveRequestLinkBody = {
  quoteRequestId?: string | null;
  opportunityId?: string | null;
  companyId?: string;
  excludeQuoteId?: string | null;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: ResolveRequestLinkBody;

  try {
    body = (await request.json()) as ResolveRequestLinkBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const companyId = body.companyId?.trim();

  if (!companyId) {
    return NextResponse.json({ error: "Company is required." }, { status: 400 });
  }

  try {
    const quoteRequestId = await resolveQuoteRequestIdForQuote(supabase, {
      quoteRequestId: body.quoteRequestId ?? null,
      opportunityId: body.opportunityId ?? null,
      companyId,
      excludeQuoteId: body.excludeQuoteId ?? undefined,
    });

    return NextResponse.json({ quoteRequestId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to resolve quote request link.",
      },
      { status: 400 }
    );
  }
}
