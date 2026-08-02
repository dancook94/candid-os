import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { deleteBrokenQuoteAsAdmin } from "@/lib/admin-quote-actions";
import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { permanentDeleteConfirmationErrorMessage } from "@/lib/permanent-delete-confirmation";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type DeleteBrokenQuoteBody = {
  confirmation?: string;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: DeleteBrokenQuoteBody;

  try {
    body = (await request.json()) as DeleteBrokenQuoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const confirmation = body.confirmation?.trim() ?? "";

  if (!confirmation) {
    return NextResponse.json(
      { error: permanentDeleteConfirmationErrorMessage() },
      { status: 400 }
    );
  }

  const result = await deleteBrokenQuoteAsAdmin(supabase, {
    quoteId: id,
    confirmation,
  });

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
