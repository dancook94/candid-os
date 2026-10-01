import { NextResponse } from "next/server";

import { reprocessSupplierInvoice } from "@/lib/materials/invoices/actions";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const result = await reprocessSupplierInvoice(id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, lineCount: result.lineCount });
}
