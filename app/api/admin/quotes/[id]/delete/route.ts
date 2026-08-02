import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { permanentlyDeleteQuoteAsAdmin } from "@/lib/admin-quote-actions";
import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type DeleteQuoteBody = {
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

  let body: DeleteQuoteBody;

  try {
    body = (await request.json()) as DeleteQuoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const confirmation = body.confirmation?.trim() ?? "";

  if (!confirmation) {
    return NextResponse.json(
      { error: "Confirmation text is required." },
      { status: 400 }
    );
  }

  const result = await permanentlyDeleteQuoteAsAdmin(supabase, {
    quoteId: id,
    confirmation,
    deletedBy: authResult.userId,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        storageWarnings: result.storageWarnings ?? [],
      },
      { status: result.status }
    );
  }

  revalidatePath("/admin");
  revalidatePath("/admin/quotes");
  revalidatePath("/admin/activity");
  revalidatePath("/dashboard");
  revalidatePath("/quotes");

  return NextResponse.json({
    success: true,
    storageWarnings: result.storageWarnings,
  });
}
