import { NextResponse } from "next/server";

import { respondToCustomerQuote } from "@/lib/customer-quote-response";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function handleQuoteResponse(
  request: Request,
  context: RouteContext,
  action: "accept" | "decline"
) {
  const { id } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await respondToCustomerQuote(supabase, {
    userId: user.id,
    quoteId: id,
    action,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  return NextResponse.json({ success: true });
}

export async function POST(_request: Request, context: RouteContext) {
  return handleQuoteResponse(_request, context, "accept");
}
