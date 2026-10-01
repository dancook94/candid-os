import { NextResponse } from "next/server";

import { correctInvoiceSupplier } from "@/lib/materials/invoices/actions";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const supplierId = typeof body?.supplierId === "string" ? body.supplierId : "";
  const result = await correctInvoiceSupplier(id, supplierId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
