import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { sendQuoteAsStaff } from "@/lib/quotes/send-quote";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SendQuoteBody = {
  versionId?: string;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id: quoteId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: SendQuoteBody;

  try {
    body = (await request.json()) as SendQuoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.versionId?.trim()) {
    return NextResponse.json(
      { error: "Quote version is required." },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();
  const result = await sendQuoteAsStaff(adminClient, supabase, {
    quoteId,
    versionId: body.versionId.trim(),
    changedBy: auth.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  if (result.opportunitySynced) {
    revalidatePath("/admin/opportunities");
  }

  revalidatePath(`/admin/quotes/${quoteId}`);

  return NextResponse.json(result);
}
