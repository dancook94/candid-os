import { NextResponse } from "next/server";

import { addInvoiceLine } from "@/lib/materials/invoices/actions";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const result = await addInvoiceLine(id, await request.json().catch(() => ({})));

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
