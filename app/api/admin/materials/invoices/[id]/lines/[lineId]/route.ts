import { NextResponse } from "next/server";

import { reviewInvoiceLine } from "@/lib/materials/invoices/actions";

type RouteContext = { params: Promise<{ id: string; lineId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id, lineId } = await context.params;
  const result = await reviewInvoiceLine(id, lineId, await request.json().catch(() => ({})));

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
