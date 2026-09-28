import { NextResponse } from "next/server";

import { updateSupplierRecord } from "@/lib/materials/actions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const result = await updateSupplierRecord(
    id,
    await request.json().catch(() => null)
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ id: result.id });
}
