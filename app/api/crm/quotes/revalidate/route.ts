import { NextResponse } from "next/server";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { revalidateQuoteWorkflowRoutes } from "@/lib/quote-route-revalidation";
import { createClient } from "@/lib/supabase/server";

type RevalidateQuoteRoutesBody = {
  quoteId?: string | null;
  quoteRequestId?: string | null;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: RevalidateQuoteRoutesBody;

  try {
    body = (await request.json()) as RevalidateQuoteRoutesBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  revalidateQuoteWorkflowRoutes({
    quoteId: body.quoteId ?? null,
    quoteRequestId: body.quoteRequestId ?? null,
  });

  return NextResponse.json({ ok: true });
}
