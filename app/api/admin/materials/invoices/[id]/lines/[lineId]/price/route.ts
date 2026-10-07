import { NextResponse } from "next/server";

import { resolveInvoicePriceChange } from "@/lib/materials/invoices/actions";

type RouteContext = { params: Promise<{ id: string; lineId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id, lineId } = await context.params;
  const body = await request.json().catch(() => null);
  const result = await resolveInvoicePriceChange(
    id,
    lineId,
    body && typeof body === "object" ? body : {}
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, result: result.result });
}
