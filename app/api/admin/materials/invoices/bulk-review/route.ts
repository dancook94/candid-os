import { NextResponse } from "next/server";

import { applyBulkReviewDecision } from "@/lib/materials/invoices/bulk-review-actions";

export async function POST(request: Request) {
  const result = await applyBulkReviewDecision(await request.json().catch(() => null));

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, alreadyComplete: result.alreadyComplete });
}
