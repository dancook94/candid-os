import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { respondToQuoteAsAdmin } from "@/lib/admin-quote-actions";
import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function revalidateQuotePaths(quoteId: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/quotes");
  revalidatePath(`/admin/quotes/${quoteId}`);
  revalidatePath("/dashboard");
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${quoteId}`);
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  const result = await respondToQuoteAsAdmin(supabase, {
    quoteId: id,
    action: "decline",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  revalidateQuotePaths(id);

  return NextResponse.json({ success: true });
}
