import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { deleteBrokenQuoteAsAdmin } from "@/lib/admin-quote-actions";
import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

  const result = await deleteBrokenQuoteAsAdmin(supabase, { quoteId: id });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/quotes");
  revalidatePath("/admin/activity");
  revalidatePath("/dashboard");
  revalidatePath("/quotes");

  return NextResponse.json({ success: true });
}
