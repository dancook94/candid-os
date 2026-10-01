import { NextResponse } from "next/server";

import { createMaterialFromInvoiceLine } from "@/lib/materials/invoices/actions";

type RouteContext = { params: Promise<{ id: string; lineId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id, lineId } = await context.params;
  const body = await request.json().catch(() => null);
  const result = await createMaterialFromInvoiceLine(
    id,
    lineId,
    body && typeof body === "object" ? body : {}
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ materialId: result.materialId });
}
